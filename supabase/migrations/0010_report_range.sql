-- ============================================================================
-- Sales X-Ray — 0010 report RPCs accept a date RANGE (from/to)
-- Replaces the p_days parameter with explicit p_from / p_to (timestamptz) so the
-- UI can use presets (today/yesterday/7/30/90/all) AND a custom date range. The
-- aggregation logic is unchanged — only the period filter becomes a range on
-- created_at_src: (p_from is null or created_at_src >= p_from) and
--                 (p_to   is null or created_at_src <= p_to).
-- ============================================================================

drop function if exists public.report_pipelines(uuid, int);
drop function if exists public.report_headline(uuid, bigint, int);
drop function if exists public.report_funnel(uuid, bigint, int);
drop function if exists public.report_loss_reasons(uuid, bigint, int);
drop function if exists public.report_managers(uuid, int);
drop function if exists public.report_manager_stages(uuid, int);

-- ─── pipelines with lead counts in the window ──────────────────────────────
create or replace function public.report_pipelines(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(external_id bigint, name text, is_main boolean, lead_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  return query
    select p.external_id, p.name, p.is_main, count(l.id)
    from public.amocrm_pipelines p
    left join public.leads l
      on l.organization_id = p.organization_id
     and l.source = 'amocrm'
     and l.pipeline_external_id = p.external_id
     and (p_from is null or l.created_at_src >= p_from)
     and (p_to is null or l.created_at_src <= p_to)
    where p.organization_id = p_org
    group by p.external_id, p.name, p.is_main, p.sort
    order by p.sort;
end $$;

-- ─── headline aggregates for a pipeline ────────────────────────────────────
create or replace function public.report_headline(p_org uuid, p_pipeline bigint, p_from timestamptz, p_to timestamptz)
returns table(
  total_leads bigint, won_count bigint, lost_count bigint, open_count bigint,
  won_value numeric, lost_value numeric, at_risk_value numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  return query
    select
      count(*)::bigint,
      count(*) filter (where is_won)::bigint,
      count(*) filter (where is_lost)::bigint,
      count(*) filter (where not is_won and not is_lost)::bigint,
      coalesce(sum(price) filter (where is_won), 0)::numeric,
      coalesce(sum(price) filter (where is_lost), 0)::numeric,
      coalesce(sum(price) filter (
        where not is_won and not is_lost
          and stage_entered_at is not null
          and stage_entered_at <= now() - interval '14 days'), 0)::numeric
    from public.leads
    where organization_id = p_org and source = 'amocrm'
      and pipeline_external_id = p_pipeline
      and (p_from is null or created_at_src >= p_from)
      and (p_to is null or created_at_src <= p_to);
end $$;

-- ─── per-stage funnel (current + cohort reached histogram) ─────────────────
create or replace function public.report_funnel(p_org uuid, p_pipeline bigint, p_from timestamptz, p_to timestamptz)
returns table(
  rank int, name text, current_count bigint, reached_exact bigint,
  avg_days numeric, stuck bigint)
language plpgsql stable security definer set search_path = public
as $$
declare v_stage_count int;
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;

  select coalesce(max(s.rank), 0) into v_stage_count
  from public.amocrm_stages s
  where s.organization_id = p_org and s.pipeline_external_id = p_pipeline
    and s.rank is not null;

  return query
  with stages as (
    select external_id, name, rank
    from public.amocrm_stages
    where organization_id = p_org and pipeline_external_id = p_pipeline
      and rank is not null
  ),
  scoped as (
    select l.is_won, l.is_lost, l.reached_rank, l.stage_entered_at, s.rank as status_rank
    from public.leads l
    left join stages s on s.external_id = l.status_external_id
    where l.organization_id = p_org and l.source = 'amocrm'
      and l.pipeline_external_id = p_pipeline
      and (p_from is null or l.created_at_src >= p_from)
      and (p_to is null or l.created_at_src <= p_to)
  ),
  eff as (
    select *,
      least(
        coalesce(reached_rank,
          case when is_won then v_stage_count
               when status_rank is not null then status_rank
               else 1 end),
        v_stage_count) as eff_rank
    from scoped
  ),
  cur as (
    select status_rank as rnk,
      count(*)::bigint c,
      coalesce(avg(extract(epoch from (now() - stage_entered_at)) / 86400), 0)::numeric ad,
      count(*) filter (
        where stage_entered_at is not null
          and stage_entered_at <= now() - interval '14 days')::bigint stk
    from eff
    where not is_won and not is_lost and status_rank is not null
    group by status_rank
  ),
  rch as (
    select eff_rank as rnk, count(*)::bigint c from eff group by eff_rank
  )
  select st.rank, st.name,
    coalesce(cur.c, 0)::bigint,
    coalesce(rch.c, 0)::bigint,
    coalesce(cur.ad, 0)::numeric,
    coalesce(cur.stk, 0)::bigint
  from stages st
  left join cur on cur.rnk = st.rank
  left join rch on rch.rnk = st.rank
  order by st.rank;
end $$;

-- ─── loss reasons ──────────────────────────────────────────────────────────
create or replace function public.report_loss_reasons(p_org uuid, p_pipeline bigint, p_from timestamptz, p_to timestamptz)
returns table(reason text, cnt bigint, value numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  return query
    select coalesce(nullif(loss_reason, ''), 'Причина не указана'),
           count(*)::bigint, coalesce(sum(price), 0)::numeric
    from public.leads
    where organization_id = p_org and source = 'amocrm'
      and pipeline_external_id = p_pipeline and is_lost
      and (p_from is null or created_at_src >= p_from)
      and (p_to is null or created_at_src <= p_to)
    group by coalesce(nullif(loss_reason, ''), 'Причина не указана')
    order by count(*) desc;
end $$;

-- ─── managers across all pipelines in the window ───────────────────────────
create or replace function public.report_managers(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(
  responsible text, name text, leads bigint, won bigint, lost bigint,
  open_count bigint, won_value numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  return query
    select
      coalesce(l.responsible, '—') as responsible,
      coalesce(
        max(au.name),
        case when l.responsible is null then 'Без ответственного'
             else 'ID ' || l.responsible end) as name,
      count(*)::bigint,
      count(*) filter (where l.is_won)::bigint,
      count(*) filter (where l.is_lost)::bigint,
      count(*) filter (where not l.is_won and not l.is_lost)::bigint,
      coalesce(sum(l.price) filter (where l.is_won), 0)::numeric
    from public.leads l
    left join public.amocrm_users au
      on au.organization_id = p_org and au.external_id::text = l.responsible
    where l.organization_id = p_org and l.source = 'amocrm'
      and (p_from is null or l.created_at_src >= p_from)
      and (p_to is null or l.created_at_src <= p_to)
    group by l.responsible
    order by count(*) desc;
end $$;

-- ─── per-manager current-stage distribution ────────────────────────────────
create or replace function public.report_manager_stages(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(responsible text, stage text, cnt bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  return query
    select coalesce(l.responsible, '—'), coalesce(l.stage, '—'), count(*)::bigint
    from public.leads l
    where l.organization_id = p_org and l.source = 'amocrm'
      and (p_from is null or l.created_at_src >= p_from)
      and (p_to is null or l.created_at_src <= p_to)
    group by coalesce(l.responsible, '—'), coalesce(l.stage, '—');
end $$;

grant execute on function public.report_pipelines(uuid, timestamptz, timestamptz) to authenticated, anon;
grant execute on function public.report_headline(uuid, bigint, timestamptz, timestamptz) to authenticated, anon;
grant execute on function public.report_funnel(uuid, bigint, timestamptz, timestamptz) to authenticated, anon;
grant execute on function public.report_loss_reasons(uuid, bigint, timestamptz, timestamptz) to authenticated, anon;
grant execute on function public.report_managers(uuid, timestamptz, timestamptz) to authenticated, anon;
grant execute on function public.report_manager_stages(uuid, timestamptz, timestamptz) to authenticated, anon;

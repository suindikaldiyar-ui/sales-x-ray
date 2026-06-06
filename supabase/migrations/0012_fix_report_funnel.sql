-- ============================================================================
-- Sales X-Ray — 0012 fix report_funnel (empty stages)
-- BUG: report_funnel RETURNS TABLE(rank int, name text, …). Inside, the `stages`
-- CTE selected the BARE columns `name` and `rank` from amocrm_stages — the same
-- identifiers as the function's OUT columns. PL/pgSQL flags that as a
-- variable/column conflict and raises at runtime, so the RPC returned an error
-- (Node swallowed it → empty funnel) while headline/loss/managers worked.
--
-- FIX: `#variable_conflict use_column` + alias the CTE columns (ext_id /
-- stage_name / stage_rank) so nothing collides with the OUT names. Logic and
-- the returned column names (rank/name/…) are unchanged.
-- ============================================================================

create or replace function public.report_funnel(
  p_org uuid, p_pipeline bigint, p_from timestamptz, p_to timestamptz)
returns table(
  rank int, name text, current_count bigint, reached_exact bigint,
  avg_days numeric, stuck bigint)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v_stage_count int;
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;

  select coalesce(max(s.rank), 0) into v_stage_count
  from public.amocrm_stages s
  where s.organization_id = p_org and s.pipeline_external_id = p_pipeline
    and s.rank is not null;

  return query
  with stages as (
    select s.external_id as ext_id, s.name as stage_name, s.rank as stage_rank
    from public.amocrm_stages s
    where s.organization_id = p_org and s.pipeline_external_id = p_pipeline
      and s.rank is not null
  ),
  scoped as (
    select l.is_won, l.is_lost, l.reached_rank, l.stage_entered_at,
           st.stage_rank as status_rank
    from public.leads l
    left join stages st on st.ext_id = l.status_external_id
    where l.organization_id = p_org and l.source = 'amocrm'
      and l.pipeline_external_id = p_pipeline
      and (p_from is null or l.created_at_src >= p_from)
      and (p_to is null or l.created_at_src <= p_to)
  ),
  eff as (
    select scoped.*,
      least(
        coalesce(scoped.reached_rank,
          case when scoped.is_won then v_stage_count
               when scoped.status_rank is not null then scoped.status_rank
               else 1 end),
        v_stage_count) as eff_rank
    from scoped
  ),
  cur as (
    select eff.status_rank as rnk,
      count(*)::bigint c,
      coalesce(avg(extract(epoch from (now() - eff.stage_entered_at)) / 86400), 0)::numeric ad,
      count(*) filter (
        where eff.stage_entered_at is not null
          and eff.stage_entered_at <= now() - interval '14 days')::bigint stk
    from eff
    where not eff.is_won and not eff.is_lost and eff.status_rank is not null
    group by eff.status_rank
  ),
  rch as (
    select eff.eff_rank as rnk, count(*)::bigint c from eff group by eff.eff_rank
  )
  select st.stage_rank, st.stage_name,
    coalesce(cur.c, 0)::bigint,
    coalesce(rch.c, 0)::bigint,
    coalesce(cur.ad, 0)::numeric,
    coalesce(cur.stk, 0)::bigint
  from stages st
  left join cur on cur.rnk = st.stage_rank
  left join rch on rch.rnk = st.stage_rank
  order by st.stage_rank;
end $$;

grant execute on function public.report_funnel(uuid, bigint, timestamptz, timestamptz)
  to authenticated, anon;

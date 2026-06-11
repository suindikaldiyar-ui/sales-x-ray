-- ============================================================================
-- Sales X-Ray — 0023 scope task diagnostics to the active funnel
-- The 0022 report_tasks counted ALL open tasks (including tasks on won/lost or
-- non-active leads and on "dead" pipelines), so overdue/today/leads-without were
-- hugely inflated vs amoCRM, which scopes these to the CURRENT funnel's active
-- (open-stage) leads. This version takes p_pipeline and counts only tasks tied
-- to OPEN leads of that pipeline — matching amoCRM's lead-list numbers.
--
-- Also note: the caller now passes an explicit end-of-day for p_today_to (the
-- old "today" had no upper bound and swept in every future task).
-- ============================================================================

drop function if exists public.report_tasks(uuid, timestamptz, timestamptz);

create or replace function public.report_tasks(
  p_org uuid, p_pipeline bigint, p_today_from timestamptz, p_today_to timestamptz)
returns table(overdue bigint, due_today bigint, leads_without_tasks bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;

  return query
  select
    -- overdue: open tasks past due, on an OPEN lead of the active pipeline
    (select count(*) from public.amocrm_tasks t
       where t.organization_id = p_org
         and t.complete_till is not null
         and t.complete_till < now()
         and exists (
           select 1 from public.leads l
           where l.organization_id = p_org and l.source = 'amocrm'
             and l.external_id = t.lead_external_id
             and l.pipeline_external_id = p_pipeline
             and not l.is_won and not l.is_lost))::bigint,

    -- due today: open tasks within [p_today_from, p_today_to], same scope
    (select count(*) from public.amocrm_tasks t
       where t.organization_id = p_org
         and t.complete_till is not null
         and (p_today_from is null or t.complete_till >= p_today_from)
         and (p_today_to   is null or t.complete_till <= p_today_to)
         and exists (
           select 1 from public.leads l
           where l.organization_id = p_org and l.source = 'amocrm'
             and l.external_id = t.lead_external_id
             and l.pipeline_external_id = p_pipeline
             and not l.is_won and not l.is_lost))::bigint,

    -- leads without tasks: OPEN leads of the active pipeline with no open task
    (select count(*) from public.leads l
       where l.organization_id = p_org and l.source = 'amocrm'
         and l.pipeline_external_id = p_pipeline
         and not l.is_won and not l.is_lost
         and not exists (
           select 1 from public.amocrm_tasks t
           where t.organization_id = p_org
             and t.lead_external_id = l.external_id))::bigint;
end $$;

grant execute on function public.report_tasks(uuid, bigint, timestamptz, timestamptz)
  to authenticated, anon;

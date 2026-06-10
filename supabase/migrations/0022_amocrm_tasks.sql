-- ============================================================================
-- Sales X-Ray — 0022 amoCRM open tasks
-- Stores a per-organization SNAPSHOT of OPEN (incomplete) amoCRM tasks tied to
-- leads. The sync replaces the snapshot wholesale per org (delete + insert) once
-- a full pass completes, so the table always reflects "currently open" tasks.
-- Powers three diagnostics: overdue tasks, tasks due today, and open leads with
-- no task at all. RLS mirrors the rest of the schema (members of the org only).
-- ============================================================================

create table if not exists public.amocrm_tasks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  external_id         text not null,         -- amoCRM task id
  lead_external_id    text,                  -- amoCRM lead id (entity_id), matches leads.external_id
  complete_till       timestamptz,           -- due time (from unix complete_till)
  responsible_user_id bigint,
  created_at          timestamptz not null default now(),
  unique (organization_id, external_id)
);

create index if not exists amocrm_tasks_org_idx
  on public.amocrm_tasks (organization_id);
create index if not exists amocrm_tasks_org_lead_idx
  on public.amocrm_tasks (organization_id, lead_external_id);
create index if not exists amocrm_tasks_org_due_idx
  on public.amocrm_tasks (organization_id, complete_till);

-- ─── RLS: members of the org get full access to their org's rows ────────────
-- (Sync runs with the service role, which bypasses RLS entirely.)
alter table public.amocrm_tasks enable row level security;
drop policy if exists amocrm_tasks_rw_member on public.amocrm_tasks;
create policy amocrm_tasks_rw_member on public.amocrm_tasks
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── task diagnostics in one round-trip (SECURITY DEFINER + membership guard)─
-- overdue            = open tasks past due
-- due_today          = open tasks due within [p_today_from, p_today_to] (Almaty)
-- leads_without_tasks = open leads (not won/lost) with no open task at all
create or replace function public.report_tasks(
  p_org uuid, p_today_from timestamptz, p_today_to timestamptz)
returns table(overdue bigint, due_today bigint, leads_without_tasks bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;

  return query
  select
    (select count(*) from public.amocrm_tasks t
       where t.organization_id = p_org
         and t.complete_till is not null
         and t.complete_till < now())::bigint,
    (select count(*) from public.amocrm_tasks t
       where t.organization_id = p_org
         and t.complete_till is not null
         and (p_today_from is null or t.complete_till >= p_today_from)
         and (p_today_to   is null or t.complete_till <= p_today_to))::bigint,
    (select count(*) from public.leads l
       where l.organization_id = p_org
         and l.source = 'amocrm'
         and not l.is_won and not l.is_lost
         and not exists (
           select 1 from public.amocrm_tasks t
           where t.organization_id = p_org
             and t.lead_external_id = l.external_id))::bigint;
end $$;

grant execute on function public.report_tasks(uuid, timestamptz, timestamptz)
  to authenticated, anon;

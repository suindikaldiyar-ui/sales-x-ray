-- ============================================================================
-- Sales X-Ray — 0006 amoCRM users (managers)
-- Stores the amoCRM user directory per organization so leads' responsible_user
-- ids resolve to real names on the "Команда продаж / Менеджеры" view.
-- ============================================================================

create table if not exists public.amocrm_users (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  external_id     bigint not null,
  name            text not null,
  email           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, external_id)
);
create index if not exists amocrm_users_org_idx
  on public.amocrm_users (organization_id);

alter table public.amocrm_users enable row level security;

drop policy if exists amocrm_users_rw_member on public.amocrm_users;
create policy amocrm_users_rw_member on public.amocrm_users
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

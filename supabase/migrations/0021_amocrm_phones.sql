-- ============================================================================
-- Sales X-Ray — 0021 amoCRM phone → responsible index
-- Links a client phone number to the amoCRM responsible manager, so Sipuni
-- calls get real manager names (from amocrm_users) by matching the call's
-- client phone — no manual Sipuni-extension mapping needed.
-- phone_norm = digits only, last 10 (so +7701…, 8701…, 7701… all match).
-- ============================================================================

create table if not exists public.amocrm_phones (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  phone_norm           text not null,
  responsible_user_id  bigint,
  created_at           timestamptz not null default now(),
  unique (organization_id, phone_norm)
);
create index if not exists amocrm_phones_org_phone_idx
  on public.amocrm_phones (organization_id, phone_norm);

alter table public.amocrm_phones enable row level security;
drop policy if exists amocrm_phones_rw_member on public.amocrm_phones;
create policy amocrm_phones_rw_member on public.amocrm_phones
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

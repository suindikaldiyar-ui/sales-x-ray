-- ============================================================================
-- Sales X-Ray — 0020 Sipuni manager map
-- Maps a Sipuni extension / internal number (202, 203, …) to a real manager
-- name (Бота, Жазира, …). Sipuni only exposes the extension; amoCRM names have
-- no shared key with it, so the mapping is maintained explicitly per org.
-- ============================================================================

create table if not exists public.sipuni_manager_map (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  extension           text not null,
  name                text not null,
  amocrm_external_id  bigint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, extension)
);
create index if not exists sipuni_manager_map_org_idx
  on public.sipuni_manager_map (organization_id);

drop trigger if exists trg_sipuni_manager_map_updated on public.sipuni_manager_map;
create trigger trg_sipuni_manager_map_updated before update on public.sipuni_manager_map
  for each row execute function public.set_updated_at();

alter table public.sipuni_manager_map enable row level security;
drop policy if exists sipuni_manager_map_rw_member on public.sipuni_manager_map;
create policy sipuni_manager_map_rw_member on public.sipuni_manager_map
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

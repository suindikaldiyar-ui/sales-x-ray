-- ============================================================================
-- Sales X-Ray — 0017 Sipuni calls
-- Extends the existing `calls` table with the fields the Sipuni statistic export
-- provides, plus an idempotent upsert key. RLS already exists (0003,
-- calls_rw_member). Storage is read-only telephony stats — no dialing/changes.
-- ============================================================================

alter table public.calls
  add column if not exists source               integration_provider,
  add column if not exists client_phone         text,
  add column if not exists manager_name         text,
  add column if not exists manager_external_id  text,
  add column if not exists status               text,
  add column if not exists answered             boolean,
  add column if not exists record_url           text;

-- Idempotent upsert (one row per Sipuni call id per org).
create unique index if not exists calls_org_external_uq
  on public.calls (organization_id, external_id);

create index if not exists calls_org_started_idx
  on public.calls (organization_id, started_at);
create index if not exists calls_org_manager_idx
  on public.calls (organization_id, manager_external_id);

-- ============================================================================
-- Sales X-Ray — 0005 incremental sync
-- Makes amoCRM sync resumable for large accounts (16k+ leads): a per-org cursor
-- in `sync_state`, an idempotent leads upsert key, and a batched RPC to bump
-- reconstructed reached-stage ranks without per-row round trips.
-- ============================================================================

-- ─── resumable cursor / progress per organization+provider ─────────────────
create table if not exists public.sync_state (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  provider         integration_provider not null default 'amocrm',
  status           text not null default 'idle',  -- idle|running|done|error
  phase            text not null default 'idle',  -- pipelines|leads|events|done
  window_days      integer not null default 30,
  date_from        bigint,                         -- unix seconds lower bound
  cursor_pipeline  integer not null default 0,     -- index into pipelines (leads phase)
  cursor_page      integer not null default 1,     -- page within current phase
  leads_synced     integer not null default 0,
  events_processed integer not null default 0,
  message          text,
  started_at       timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, provider)
);

alter table public.sync_state enable row level security;

drop policy if exists sync_state_rw_member on public.sync_state;
create policy sync_state_rw_member on public.sync_state
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── idempotent upsert key for leads (safe to re-run a page on retry) ──────
-- Non-partial unique index so ON CONFLICT can infer it. (Nulls are distinct,
-- so future non-amoCRM rows with null external_id are unaffected.)
create unique index if not exists leads_org_source_external_uq
  on public.leads (organization_id, source, external_id);

-- ─── batched reached-rank bump ─────────────────────────────────────────────
-- Raises each lead's reached_rank to the furthest stage seen in its history.
-- SECURITY INVOKER (default) → still subject to RLS (member updates own org).
create or replace function public.apply_reached_ranks(
  p_org uuid,
  p_lead_ids text[],
  p_ranks integer[]
)
returns void
language sql
as $$
  update public.leads l
  set reached_rank = greatest(coalesce(l.reached_rank, 1), v.rank)
  from unnest(p_lead_ids, p_ranks) as v(ext, rank)
  where l.organization_id = p_org
    and l.source = 'amocrm'
    and l.external_id = v.ext;
$$;

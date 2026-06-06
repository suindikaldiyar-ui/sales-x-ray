-- ============================================================================
-- Sales X-Ray — 0019 AI call analysis
-- Caches the Gemini transcript + sales analysis of a Sipuni call recording, so
-- we never re-spend quota on the same call. Mirrors conversation_analysis.
-- ============================================================================

create table if not exists public.call_analysis (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  call_id         uuid not null references public.calls (id) on delete cascade,
  transcript      text,
  analysis        jsonb not null default '{}'::jsonb,
  model           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, call_id)
);
create index if not exists call_analysis_org_idx
  on public.call_analysis (organization_id);

drop trigger if exists trg_call_analysis_updated on public.call_analysis;
create trigger trg_call_analysis_updated before update on public.call_analysis
  for each row execute function public.set_updated_at();

alter table public.call_analysis enable row level security;
drop policy if exists call_analysis_rw_member on public.call_analysis;
create policy call_analysis_rw_member on public.call_analysis
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ============================================================================
-- Sales X-Ray — 0009 AI layer (Google Gemini)
-- Per-organization AI settings (BYOK key + on/off toggle), cached conversation
-- analyses, and AI sales reports stored in daily_reports. Gemini keys live here
-- (server-only access) — never sent to the browser.
-- ============================================================================

-- ─── per-org AI settings: BYOK Gemini key + enable toggle ──────────────────
create table if not exists public.ai_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  gemini_api_key  text,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_ai_settings_updated on public.ai_settings;
create trigger trg_ai_settings_updated before update on public.ai_settings
  for each row execute function public.set_updated_at();

alter table public.ai_settings enable row level security;

-- Members may read settings (the app only ever exposes `enabled`/`hasKey` to
-- the client, never the key). Only OWNER/ROP may change them.
drop policy if exists ai_settings_select_member on public.ai_settings;
create policy ai_settings_select_member on public.ai_settings
  for select using (public.is_org_member(organization_id));

drop policy if exists ai_settings_write_admin on public.ai_settings;
create policy ai_settings_write_admin on public.ai_settings
  for all using (public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[]))
  with check (public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[]));

-- ─── cached AI analysis per conversation (one per conversation) ────────────
create table if not exists public.conversation_analysis (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  result          jsonb not null default '{}'::jsonb,
  model           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, conversation_id)
);
create index if not exists conversation_analysis_org_idx
  on public.conversation_analysis (organization_id);

alter table public.conversation_analysis enable row level security;
drop policy if exists conversation_analysis_rw_member on public.conversation_analysis;
create policy conversation_analysis_rw_member on public.conversation_analysis
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── AI sales reports in daily_reports (kind/period/content + history) ──────
alter table public.daily_reports
  add column if not exists kind    text not null default 'daily',
  add column if not exists period  text,
  add column if not exists title   text,
  add column if not exists content text,
  add column if not exists model   text;

-- The old "one report per date" constraint blocks multiple periods/kinds per
-- day; replace it with a key that caches one report per (kind, period, date).
alter table public.daily_reports
  drop constraint if exists daily_reports_organization_id_report_date_key;
create unique index if not exists daily_reports_org_kind_period_date_uq
  on public.daily_reports (organization_id, kind, period, report_date);
create index if not exists daily_reports_org_kind_idx
  on public.daily_reports (organization_id, kind, created_at);

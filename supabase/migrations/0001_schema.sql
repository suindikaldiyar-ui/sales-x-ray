-- ============================================================================
-- Sales X-Ray — 0001 schema
-- Multi-tenant core: organizations, profiles, memberships, subscriptions,
-- invitations, integrations, plus future data tables (leads, conversations,
-- messages, calls, daily_reports). All tenant data is scoped by organization_id.
--
-- RLS is enabled in 0002_rls.sql. Privileged signup/invite flows live in
-- 0003_functions.sql as SECURITY DEFINER functions.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── Enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type membership_role as enum ('OWNER', 'ROP', 'MOP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invitation_status as enum ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type integration_provider as enum ('amocrm', 'wazzup', 'sipuni', 'telegram');
exception when duplicate_object then null; end $$;

do $$ begin
  create type integration_status as enum ('NOT_CONNECTED', 'CONNECTED', 'ERROR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_plan as enum ('TRIAL', 'STARTER', 'GROWTH', 'SCALE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');
exception when duplicate_object then null; end $$;

-- ─── updated_at trigger helper ─────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─── profiles (mirror of auth.users) ───────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── organizations (the tenant) ────────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── memberships (User ↔ Organization with a role) ─────────────────────────
create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            membership_role not null default 'MOP',
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx on public.memberships (organization_id);

-- ─── subscriptions (scaffolded for billing — no billing logic yet) ─────────
create table if not exists public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null unique references public.organizations (id) on delete cascade,
  plan                  subscription_plan not null default 'TRIAL',
  status                subscription_status not null default 'TRIALING',
  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz not null default (now() + interval '14 days'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── invitations (invite by email into an organization) ────────────────────
create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null,
  role            membership_role not null default 'MOP',
  status          invitation_status not null default 'PENDING',
  token           uuid not null unique default gen_random_uuid(),
  invited_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days')
);
create unique index if not exists invitations_pending_unique
  on public.invitations (organization_id, lower(email))
  where status = 'PENDING';

-- ─── integrations (per-organization provider credentials) ──────────────────
-- Tokens/keys live in `config` (jsonb). RLS limits reads to members; in the app
-- secrets are only ever read on the server. Real sync is added later.
create table if not exists public.integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider        integration_provider not null,
  status          integration_status not null default 'NOT_CONNECTED',
  config          jsonb not null default '{}'::jsonb,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, provider)
);

-- ─── leads (future amoCRM sync target) ─────────────────────────────────────
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  external_id     text,
  source          integration_provider,
  pipeline        text,
  stage           text,
  status          text,
  title           text,
  price           numeric,
  responsible     text,
  created_at_src  timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists leads_org_idx on public.leads (organization_id);
create unique index if not exists leads_org_external_idx
  on public.leads (organization_id, source, external_id)
  where external_id is not null;

-- ─── conversations (chat threads from Wazzup etc.) ─────────────────────────
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  external_id     text,
  channel         text,
  contact_name    text,
  contact_handle  text,
  started_at      timestamptz,
  last_message_at timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists conversations_org_idx on public.conversations (organization_id);

-- ─── messages (individual messages within a conversation) ──────────────────
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  external_id     text,
  direction       text, -- 'in' | 'out'
  author          text,
  body            text,
  sent_at         timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists messages_org_idx on public.messages (organization_id);
create index if not exists messages_conversation_idx on public.messages (conversation_id);

-- ─── calls (telephony records from Sipuni etc.) ────────────────────────────
create table if not exists public.calls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  external_id     text,
  direction       text, -- 'in' | 'out'
  from_number     text,
  to_number       text,
  manager         text,
  duration_sec    integer,
  recording_url   text,
  started_at      timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists calls_org_idx on public.calls (organization_id);

-- ─── daily_reports (precomputed report payloads for Telegram digests) ──────
create table if not exists public.daily_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  report_date     date not null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (organization_id, report_date)
);
create index if not exists daily_reports_org_idx on public.daily_reports (organization_id);

-- ─── updated_at triggers ───────────────────────────────────────────────────
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_organizations_updated on public.organizations;
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated on public.subscriptions;
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_integrations_updated on public.integrations;
create trigger trg_integrations_updated before update on public.integrations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_updated on public.leads;
create trigger trg_leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

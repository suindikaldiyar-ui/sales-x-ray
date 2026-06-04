-- ============================================================================
-- Sales X-Ray — 0007 Wazzup (переписка)
-- Wazzup API v3 has NO REST endpoint for message history — incoming messages
-- arrive ONLY via webhooks. So this migration:
--   • stores the readable directories (channels, users) we CAN sync over REST;
--   • extends conversations/messages with the fields a webhook ingest needs;
--   • adds idempotent unique keys so ingest/sync upserts never duplicate.
-- ============================================================================

-- ─── Wazzup channels directory (GET /v3/channels) ──────────────────────────
create table if not exists public.wazzup_channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id      text not null,
  transport       text,            -- whatsapp | telegram | instagram | ...
  state           text,            -- active | ...
  name            text,
  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (organization_id, channel_id)
);
create index if not exists wazzup_channels_org_idx
  on public.wazzup_channels (organization_id);

-- ─── Wazzup users directory (GET /v3/users) — managers in messengers ───────
create table if not exists public.wazzup_users (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  external_id     text not null,
  name            text not null,
  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (organization_id, external_id)
);
create index if not exists wazzup_users_org_idx
  on public.wazzup_users (organization_id);

-- ─── extend conversations (dialog metadata + denormalized last message) ────
alter table public.conversations
  add column if not exists channel_id           text,
  add column if not exists transport            text,
  add column if not exists responsible_user_id  text,
  add column if not exists last_message_text    text,
  add column if not exists last_message_inbound boolean,
  add column if not exists source               integration_provider;

-- Idempotent upsert key for webhook ingest / sync (nulls are distinct, so
-- non-Wazzup conversations with null external_id are unaffected).
create unique index if not exists conversations_org_external_uq
  on public.conversations (organization_id, external_id);

-- ─── extend messages (direction is already present: 'in' | 'out') ──────────
alter table public.messages
  add column if not exists author_name   text,
  add column if not exists status        text,
  add column if not exists message_type  text;

create unique index if not exists messages_org_external_uq
  on public.messages (organization_id, external_id);

-- ─── RLS for the new tables (members of the org get full access) ───────────
alter table public.wazzup_channels enable row level security;
alter table public.wazzup_users    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['wazzup_channels','wazzup_users']
  loop
    execute format('drop policy if exists %I_rw_member on public.%I;', t, t);
    execute format(
      'create policy %I_rw_member on public.%I for all '
      || 'using (public.is_org_member(organization_id)) '
      || 'with check (public.is_org_member(organization_id));', t, t);
  end loop;
end $$;

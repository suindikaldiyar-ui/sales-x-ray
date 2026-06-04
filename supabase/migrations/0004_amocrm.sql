-- ============================================================================
-- Sales X-Ray — 0004 amoCRM sync targets
-- Adds the per-organization pipeline/stage catalog and extends `leads` with the
-- columns the funnel analytics needs (positional rank, reached stage, won/lost
-- flags). Stage ORDER is stored as a positional `rank` (1..N over open stages),
-- never the raw amoCRM `sort` field. RLS mirrors the rest of the schema:
-- members of the organization get full access to their own rows.
-- ============================================================================

-- ─── pipeline catalog (one row per amoCRM pipeline) ────────────────────────
create table if not exists public.amocrm_pipelines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  external_id     bigint not null,
  name            text not null,
  is_main         boolean not null default false,
  sort            integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, external_id)
);
create index if not exists amocrm_pipelines_org_idx
  on public.amocrm_pipelines (organization_id);

-- ─── stage catalog (one row per amoCRM status) ─────────────────────────────
-- `rank` = 1-based position within the pipeline's OPEN stages (won/lost = null).
create table if not exists public.amocrm_stages (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  pipeline_external_id  bigint not null,
  external_id           bigint not null,
  name                  text not null,
  rank                  integer,
  is_won                boolean not null default false,
  is_lost               boolean not null default false,
  color                 text,
  created_at            timestamptz not null default now(),
  unique (organization_id, external_id)
);
create index if not exists amocrm_stages_org_idx
  on public.amocrm_stages (organization_id);
create index if not exists amocrm_stages_pipeline_idx
  on public.amocrm_stages (organization_id, pipeline_external_id);

-- ─── extend leads with amoCRM funnel fields ────────────────────────────────
alter table public.leads
  add column if not exists pipeline_external_id bigint,
  add column if not exists status_external_id   bigint,
  add column if not exists reached_rank         integer,
  add column if not exists is_won               boolean not null default false,
  add column if not exists is_lost              boolean not null default false,
  add column if not exists loss_reason          text,
  add column if not exists stage_entered_at     timestamptz,
  add column if not exists closed_at            timestamptz;

create index if not exists leads_org_pipeline_idx
  on public.leads (organization_id, pipeline_external_id);
create index if not exists leads_org_created_idx
  on public.leads (organization_id, created_at_src);

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table public.amocrm_pipelines enable row level security;
alter table public.amocrm_stages    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['amocrm_pipelines','amocrm_stages']
  loop
    execute format('drop policy if exists %I_rw_member on public.%I;', t, t);
    execute format(
      'create policy %I_rw_member on public.%I for all '
      || 'using (public.is_org_member(organization_id)) '
      || 'with check (public.is_org_member(organization_id));', t, t);
  end loop;
end $$;

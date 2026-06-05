-- ============================================================================
-- Sales X-Ray — 0011 auto-sync timestamp
-- Tracks the last AUTOMATIC (cron) amoCRM sync separately from manual syncs, so
-- the UI can show "обновлено автоматически N назад".
-- ============================================================================

alter table public.integrations
  add column if not exists last_auto_synced_at timestamptz;

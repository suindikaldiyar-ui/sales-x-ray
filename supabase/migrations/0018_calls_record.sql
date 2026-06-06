-- ============================================================================
-- Sales X-Ray — 0018 calls record fields
-- Splits the Sipuni record columns: `record_id` (col «ID записи» — needed to
-- request the recording later) and `has_record` (col «Запись существует» — a
-- 1/0 flag). `record_url` stays for compatibility.
-- ============================================================================

alter table public.calls
  add column if not exists record_id  text,
  add column if not exists has_record boolean;

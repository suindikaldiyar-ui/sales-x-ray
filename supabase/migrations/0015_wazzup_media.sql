-- ============================================================================
-- Sales X-Ray — 0015 Wazzup media (photos) + voice transcript
-- Adds messages.media_url (link to the photo/audio file from the webhook) and
-- messages.transcript (cached Gemini transcription of voice messages). Backfills
-- media_url from the stored raw payload for existing media messages.
-- The exact field name is verified against a real payload; we try the common
-- Wazzup names (contentUri / mediaUrl / url) for non-text messages.
-- ============================================================================

alter table public.messages
  add column if not exists media_url  text,
  add column if not exists transcript text;

update public.messages mm
set media_url = coalesce(
  mm.media_url,
  mm.raw->>'contentUri',
  mm.raw->>'mediaUrl',
  mm.raw->>'url'
)
from public.conversations c
where c.id = mm.conversation_id
  and c.source = 'wazzup'
  and mm.raw is not null
  and mm.raw <> '{}'::jsonb
  and lower(coalesce(mm.message_type, '')) <> 'text'
  and (mm.raw->>'contentUri' is not null
       or mm.raw->>'mediaUrl' is not null
       or mm.raw->>'url' is not null);

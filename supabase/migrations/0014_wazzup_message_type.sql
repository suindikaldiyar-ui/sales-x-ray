-- ============================================================================
-- Sales X-Ray — 0014 Wazzup message type (non-text messages)
-- Adds conversations.last_message_type and backfills message_type / body from
-- the stored raw payload, so non-text messages (missing_call, image, video,
-- voice, document, geo, contact, …) render a friendly chip instead of "—".
-- ============================================================================

alter table public.conversations
  add column if not exists last_message_type text;

-- 1) Messages: fill message_type (and text body) from raw for Wazzup messages.
update public.messages mm
set
  message_type = coalesce(mm.message_type, mm.raw->>'type'),
  body = coalesce(mm.body, mm.raw->>'text', mm.raw->>'content')
from public.conversations c
where c.id = mm.conversation_id
  and c.source = 'wazzup'
  and mm.raw is not null
  and mm.raw <> '{}'::jsonb;

-- 2) Conversations: last_message_type + last_message_text from the latest msg.
update public.conversations c
set last_message_type = sub.mtype,
    last_message_text = sub.body
from (
  select distinct on (conversation_id)
         conversation_id, message_type as mtype, body
  from public.messages
  order by conversation_id, sent_at desc nulls last
) sub
where c.id = sub.conversation_id and c.source = 'wazzup';

-- ============================================================================
-- Sales X-Ray — 0016 robust backfill of messages.media_url
-- The earlier backfill (0015) missed some already-stored media messages. This
-- one extracts the file link from the stored raw payload trying BOTH shapes —
-- the message object itself (raw->>'contentUri') and a wrapped envelope
-- (raw->'messages'->0->>'contentUri') — with mediaUrl/url fallbacks. It also
-- fills message_type when it was null, so old photos/voice render correctly.
-- Logs how many rows were updated via RAISE NOTICE.
-- ============================================================================

do $$
declare n integer;
begin
  update public.messages mm
  set
    media_url = coalesce(
      nullif(mm.raw->>'contentUri', ''),
      nullif(mm.raw->>'mediaUrl', ''),
      nullif(mm.raw->>'url', ''),
      nullif(mm.raw->'messages'->0->>'contentUri', ''),
      nullif(mm.raw->'messages'->0->>'mediaUrl', ''),
      nullif(mm.raw->'messages'->0->>'url', '')
    ),
    message_type = coalesce(
      mm.message_type,
      nullif(mm.raw->>'type', ''),
      nullif(mm.raw->'messages'->0->>'type', '')
    )
  from public.conversations c
  where c.id = mm.conversation_id
    and c.source = 'wazzup'
    and mm.media_url is null
    and mm.raw is not null
    and coalesce(
      nullif(mm.raw->>'contentUri', ''),
      nullif(mm.raw->>'mediaUrl', ''),
      nullif(mm.raw->>'url', ''),
      nullif(mm.raw->'messages'->0->>'contentUri', ''),
      nullif(mm.raw->'messages'->0->>'mediaUrl', ''),
      nullif(mm.raw->'messages'->0->>'url', '')
    ) is not null;

  get diagnostics n = row_count;
  raise notice '[backfill media_url] updated % messages', n;
end $$;

-- Keep the conversation's denormalized last_message_type in sync (latest msg).
update public.conversations c
set last_message_type = sub.mtype
from (
  select distinct on (conversation_id)
         conversation_id, message_type as mtype
  from public.messages
  order by conversation_id, sent_at desc nulls last
) sub
where c.id = sub.conversation_id and c.source = 'wazzup';

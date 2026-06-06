-- ============================================================================
-- Sales X-Ray — 0013 backfill Wazzup message direction/author from raw
-- Earlier webhook ingest guessed direction and stored almost everything as
-- "out". Webhooks don't replay history, so we re-derive direction + author from
-- the stored raw payload using the correct rule:
--   inbound  ⟺  lower(raw->>'status') = 'inbound'   (else outbound)
-- Author: inbound → contact.name (client); outbound → authorName (manager).
-- ============================================================================

-- 1) Messages: fix direction + author from raw.
update public.messages mm
set
  direction = case when lower(coalesce(mm.raw->>'status', '')) = 'inbound' then 'in' else 'out' end,
  author_name = case
    when lower(coalesce(mm.raw->>'status', '')) = 'inbound'
      then mm.raw->'contact'->>'name'
      else coalesce(mm.raw->>'authorName', mm.author_name)
  end,
  author = case
    when lower(coalesce(mm.raw->>'status', '')) = 'inbound'
      then mm.raw->'contact'->>'name'
      else coalesce(mm.raw->>'authorName', mm.author)
  end
from public.conversations c
where c.id = mm.conversation_id
  and c.source = 'wazzup'
  and mm.raw is not null
  and mm.raw <> '{}'::jsonb;

-- 2) Conversations: last_message_inbound from the latest message direction.
update public.conversations c
set last_message_inbound = sub.inbound
from (
  select distinct on (conversation_id)
         conversation_id, (direction = 'in') as inbound
  from public.messages
  order by conversation_id, sent_at desc nulls last
) sub
where c.id = sub.conversation_id and c.source = 'wazzup';

-- 3) Conversations: restore the client contact name (the old bug could store a
--    manager name here for outbound-only chats).
update public.conversations c
set contact_name = sub.cname
from (
  select distinct on (conversation_id)
         conversation_id, raw->'contact'->>'name' as cname
  from public.messages
  where raw->'contact'->>'name' is not null
  order by conversation_id, sent_at desc nulls last
) sub
where c.id = sub.conversation_id
  and c.source = 'wazzup'
  and sub.cname is not null;

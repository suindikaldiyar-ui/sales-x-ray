import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePeriod, periodStart, type PeriodKey } from "@/lib/periods";

export interface ConvFeedItem {
  id: string;
  contactName: string | null;
  contactHandle: string | null;
  transport: string | null;
  managerName: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  lastMessageInbound: boolean | null;
  unanswered: boolean;
}

export interface ManagerChatStat {
  id: string;
  name: string;
  dialogs: number;
  unanswered: number;
  avgFirstResponseMin: number | null;
}

export interface ConversationsData {
  connected: boolean;
  synced: boolean; // a Wazzup sync has run (channels present)
  lastSyncedAt: string | null;
  channels: { transport: string | null; name: string | null; state: string | null }[];
  period: PeriodKey;
  hasMessages: boolean;
  // analytics (over messages in the period)
  dialogs: number;
  newLeads: number;
  unansweredCount: number;
  avgFirstResponseMin: number | null;
  unanswered: ConvFeedItem[];
  managers: ManagerChatStat[];
  feed: ConvFeedItem[];
}

interface ConvRow {
  id: string;
  external_id: string | null;
  contact_name: string | null;
  contact_handle: string | null;
  transport: string | null;
  responsible_user_id: string | null;
  last_message_at: string | null;
  last_message_text: string | null;
  last_message_inbound: boolean | null;
}

interface MsgRow {
  conversation_id: string;
  direction: string | null;
  author_name: string | null;
  sent_at: string | null;
}

const toSec = (iso: string | null): number =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : 0;

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  apply: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await apply(
      supabase.from(table).select(columns).order("id", { ascending: true }),
    ).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/**
 * Assemble the «Переписка» analytics from synced Wazzup data. Message history
 * comes from the webhook ingest (next step after deploy); until then the
 * numbers are honestly zero while the connected channels still show.
 */
export async function getConversationsData(
  supabase: SupabaseClient,
  org: string,
  opts: { period?: string | null },
): Promise<ConversationsData> {
  const period = normalizePeriod(opts.period);
  const from = periodStart(period);

  const { data: integration } = await supabase
    .from("integrations")
    .select("status, last_synced_at")
    .eq("organization_id", org)
    .eq("provider", "wazzup")
    .maybeSingle();
  const connected = integration?.status === "CONNECTED";
  const lastSyncedAt = (integration?.last_synced_at as string | null) ?? null;

  const [channels, users, convs, msgs] = await Promise.all([
    fetchAll<{ transport: string | null; name: string | null; state: string | null }>(
      supabase,
      "wazzup_channels",
      "transport, name, state",
      (q) => q.eq("organization_id", org),
    ),
    fetchAll<{ external_id: string; name: string }>(
      supabase,
      "wazzup_users",
      "external_id, name",
      (q) => q.eq("organization_id", org),
    ),
    fetchAll<ConvRow>(
      supabase,
      "conversations",
      "id, external_id, contact_name, contact_handle, transport, responsible_user_id, last_message_at, last_message_text, last_message_inbound",
      (q) => q.eq("organization_id", org).eq("source", "wazzup"),
    ),
    fetchAll<MsgRow>(
      supabase,
      "messages",
      "conversation_id, direction, author_name, sent_at",
      (q) => q.eq("organization_id", org),
    ),
  ]);

  const nameByUser = new Map<string, string>(users.map((u) => [u.external_id, u.name]));
  const managerName = (id: string | null) =>
    id ? nameByUser.get(id) ?? `ID ${id}` : "Без ответственного";

  // Group messages by conversation, compute per-conversation timing.
  interface ConvAgg {
    firstInbound: number | null;
    firstResponse: number | null;
    lastAt: number;
    lastInbound: boolean;
    /** Manager who replied — taken from the outbound message author (Wazzup
     * webhook `authorName`), since the Wazzup users directory isn't readable. */
    manager: string | null;
  }
  const agg = new Map<string, ConvAgg>();
  const byConvMsgs = new Map<string, MsgRow[]>();
  for (const m of msgs) {
    const arr = byConvMsgs.get(m.conversation_id) ?? [];
    arr.push(m);
    byConvMsgs.set(m.conversation_id, arr);
  }
  for (const [cid, arr] of byConvMsgs) {
    arr.sort((a, b) => toSec(a.sent_at) - toSec(b.sent_at));
    let firstInbound: number | null = null;
    let firstResponse: number | null = null;
    let manager: string | null = null;
    for (const m of arr) {
      const t = toSec(m.sent_at);
      if (m.direction === "in" && firstInbound == null) firstInbound = t;
      if (m.direction === "out" && firstInbound != null && firstResponse == null && t >= firstInbound) {
        firstResponse = t;
      }
      // Latest non-empty outbound author wins.
      if (m.direction === "out" && m.author_name) manager = m.author_name;
    }
    const last = arr[arr.length - 1];
    agg.set(cid, {
      firstInbound,
      firstResponse,
      lastAt: toSec(last.sent_at),
      lastInbound: last.direction === "in",
      manager,
    });
  }

  const convById = new Map<string, ConvRow>(convs.map((c) => [c.id, c]));
  const inPeriod = (lastAt: number) => from == null || lastAt >= from;

  let dialogs = 0;
  let newLeads = 0;
  const responseTimes: number[] = [];
  const unanswered: ConvFeedItem[] = [];
  const mgrAgg = new Map<string, { name: string; dialogs: number; unanswered: number; resp: number[] }>();

  // Manager name: prefer the message author (Wazzup), fall back to the
  // conversation's responsible id resolved via wazzup_users (if ever present).
  const convManager = (c: ConvRow): string | null =>
    agg.get(c.id)?.manager ?? (c.responsible_user_id ? managerName(c.responsible_user_id) : null);

  function toFeedItem(c: ConvRow, lastInbound: boolean, isUnanswered: boolean): ConvFeedItem {
    return {
      id: c.id,
      contactName: c.contact_name,
      contactHandle: c.contact_handle,
      transport: c.transport,
      managerName: convManager(c),
      lastMessageText: c.last_message_text,
      lastMessageAt: c.last_message_at,
      lastMessageInbound: c.last_message_inbound ?? lastInbound,
      unanswered: isUnanswered,
    };
  }

  for (const [cid, a] of agg) {
    if (!inPeriod(a.lastAt)) continue;
    const c = convById.get(cid);
    if (!c) continue;
    dialogs += 1;
    if (a.firstInbound != null && (from == null || a.firstInbound >= from)) newLeads += 1;
    if (a.firstInbound != null && a.firstResponse != null) {
      responseTimes.push(a.firstResponse - a.firstInbound);
    }
    const isUnanswered = a.lastInbound;
    if (isUnanswered) unanswered.push(toFeedItem(c, a.lastInbound, true));

    const mname = a.manager ?? "Без ответственного";
    const mid = mname;
    const m = mgrAgg.get(mid) ?? { name: mname, dialogs: 0, unanswered: 0, resp: [] };
    m.dialogs += 1;
    if (isUnanswered) m.unanswered += 1;
    if (a.firstInbound != null && a.firstResponse != null) m.resp.push(a.firstResponse - a.firstInbound);
    mgrAgg.set(mid, m);
  }

  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length / 60) * 10) / 10 : null;

  const managers: ManagerChatStat[] = [...mgrAgg.entries()]
    .map(([id, m]) => ({
      id,
      name: m.name,
      dialogs: m.dialogs,
      unanswered: m.unanswered,
      avgFirstResponseMin: avg(m.resp),
    }))
    .sort((a, b) => b.dialogs - a.dialogs);

  // Feed: most recently active conversations.
  const feed: ConvFeedItem[] = [...convs]
    .sort((a, b) => toSec(b.last_message_at) - toSec(a.last_message_at))
    .slice(0, 50)
    .map((c) => {
      const a = agg.get(c.id);
      const isUnanswered = a ? a.lastInbound : c.last_message_inbound === true;
      return toFeedItem(c, isUnanswered, isUnanswered);
    });

  return {
    connected,
    synced: channels.length > 0,
    lastSyncedAt,
    channels,
    period,
    hasMessages: msgs.length > 0,
    dialogs,
    newLeads,
    unansweredCount: unanswered.length,
    avgFirstResponseMin: avg(responseTimes),
    unanswered: unanswered.slice(0, 50),
    managers,
    feed,
  };
}

export interface ThreadMessage {
  id: string;
  inbound: boolean;
  authorName: string | null;
  body: string | null;
  sentAt: string | null;
}
export interface ConversationThread {
  contactName: string | null;
  contactHandle: string | null;
  transport: string | null;
  messages: ThreadMessage[];
}

/** Load a single conversation's messages for the viewer. */
export async function getConversationThread(
  supabase: SupabaseClient,
  org: string,
  conversationId: string,
): Promise<ConversationThread | null> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, contact_name, contact_handle, transport")
    .eq("organization_id", org)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, direction, author_name, body, sent_at")
    .eq("organization_id", org)
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .limit(1000);

  return {
    contactName: (conv as any).contact_name,
    contactHandle: (conv as any).contact_handle,
    transport: (conv as any).transport,
    messages: ((msgs as any[]) ?? []).map((m) => ({
      id: m.id,
      inbound: m.direction === "in",
      authorName: m.author_name,
      body: m.body,
      sentAt: m.sent_at,
    })),
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRange, type RangeParams } from "@/lib/period-range";

export interface CallItem {
  id: string;
  direction: "in" | "out" | null;
  clientPhone: string | null;
  managerName: string | null;
  durationSec: number;
  status: string | null;
  answered: boolean;
  hasRecord: boolean;
  hasAnalysis: boolean;
  startedAt: string | null;
}

export interface ManagerCallStat {
  name: string;
  total: number;
  answered: number;
  missed: number;
  inbound: number;
  outbound: number;
  avgDurationSec: number;
}

export interface CallsData {
  connected: boolean;
  synced: boolean;
  lastSyncedAt: string | null;
  period: string;
  periodLabel: string;
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  avgDurationSec: number;
  managers: ManagerCallStat[];
  calls: CallItem[];
}

interface CallRow {
  id: string;
  direction: string | null;
  client_phone: string | null;
  manager_name: string | null;
  duration_sec: number | null;
  status: string | null;
  answered: boolean | null;
  has_record: boolean | null;
  started_at: string | null;
}

const toSec = (iso: string | null): number =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : 0;

async function fetchAll(
  supabase: SupabaseClient,
  org: string,
): Promise<CallRow[]> {
  const out: CallRow[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("calls")
      .select("id, direction, client_phone, manager_name, duration_sec, status, answered, has_record, started_at")
      .eq("organization_id", org)
      .eq("source", "sipuni")
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`calls: ${error.message}`);
    const rows = (data as CallRow[]) ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/** Telephony stats + recent calls for the period (Asia/Almaty day boundaries). */
export async function getCallsData(
  supabase: SupabaseClient,
  org: string,
  opts: RangeParams,
): Promise<CallsData> {
  const range = resolveRange(opts);
  const fromSec = range.from ? Math.floor(range.from.getTime() / 1000) : null;
  const toSecBound = range.to ? Math.floor(range.to.getTime() / 1000) : null;

  const { data: integration } = await supabase
    .from("integrations")
    .select("status, last_synced_at")
    .eq("organization_id", org)
    .eq("provider", "sipuni")
    .maybeSingle();
  const connected = integration?.status === "CONNECTED";
  const lastSyncedAt = (integration?.last_synced_at as string | null) ?? null;

  const all = await fetchAll(supabase, org);
  const rows = all.filter((c) => {
    const t = toSec(c.started_at);
    if (fromSec != null && t < fromSec) return false;
    if (toSecBound != null && t > toSecBound) return false;
    return true;
  });

  const inbound = rows.filter((c) => c.direction === "in").length;
  const outbound = rows.filter((c) => c.direction === "out").length;
  const answered = rows.filter((c) => c.answered).length;
  const missed = rows.length - answered;
  const answeredDur = rows.filter((c) => c.answered && (c.duration_sec ?? 0) > 0);
  const avgDurationSec = answeredDur.length
    ? Math.round(answeredDur.reduce((a, c) => a + (c.duration_sec ?? 0), 0) / answeredDur.length)
    : 0;

  // Per-manager breakdown.
  const mgr = new Map<string, ManagerCallStat & { _durSum: number; _durN: number }>();
  for (const c of rows) {
    const name = c.manager_name || "Без ответственного";
    let m = mgr.get(name);
    if (!m) {
      m = { name, total: 0, answered: 0, missed: 0, inbound: 0, outbound: 0, avgDurationSec: 0, _durSum: 0, _durN: 0 };
      mgr.set(name, m);
    }
    m.total += 1;
    if (c.answered) m.answered += 1;
    else m.missed += 1;
    if (c.direction === "in") m.inbound += 1;
    else if (c.direction === "out") m.outbound += 1;
    if (c.answered && (c.duration_sec ?? 0) > 0) {
      m._durSum += c.duration_sec ?? 0;
      m._durN += 1;
    }
  }
  const managers: ManagerCallStat[] = [...mgr.values()]
    .map((m) => ({
      name: m.name,
      total: m.total,
      answered: m.answered,
      missed: m.missed,
      inbound: m.inbound,
      outbound: m.outbound,
      avgDurationSec: m._durN ? Math.round(m._durSum / m._durN) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Which calls already have a cached AI analysis (for the list indicator).
  const { data: an } = await supabase
    .from("call_analysis")
    .select("call_id")
    .eq("organization_id", org);
  const analyzed = new Set(((an as any[]) ?? []).map((r) => r.call_id as string));

  const calls: CallItem[] = [...rows]
    .sort((a, b) => toSec(b.started_at) - toSec(a.started_at))
    .slice(0, 100)
    .map((c) => ({
      id: c.id,
      direction: (c.direction as "in" | "out" | null) ?? null,
      clientPhone: c.client_phone,
      managerName: c.manager_name,
      durationSec: c.duration_sec ?? 0,
      status: c.status,
      answered: Boolean(c.answered),
      hasRecord: Boolean(c.has_record),
      hasAnalysis: analyzed.has(c.id),
      startedAt: c.started_at,
    }));

  return {
    connected,
    synced: all.length > 0,
    lastSyncedAt,
    period: range.key,
    periodLabel: range.label,
    total: rows.length,
    inbound,
    outbound,
    answered,
    missed,
    avgDurationSec,
    managers,
    calls,
  };
}

/** "3:45" / "0:12" */
export function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

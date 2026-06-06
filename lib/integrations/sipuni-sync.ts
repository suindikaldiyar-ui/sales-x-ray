import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSipuniClient, type SipuniConfig, type SipuniCall } from "./sipuni";

export class SipuniConfigError extends Error {}

/** How far back the calls sync pulls (Sipuni export is one request). */
export const SIPUNI_WINDOW_DAYS = Number(process.env.SIPUNI_WINDOW_DAYS) || 90;

export interface SipuniSyncSummary {
  total: number;
  added: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  message: string;
}

async function countCalls(supabase: SupabaseClient, org: string): Promise<number> {
  const { count } = await supabase
    .from("calls")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", org)
    .eq("source", "sipuni");
  return count ?? 0;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Pull Sipuni call statistics for the recent window and upsert them into
 * `calls` (idempotent on organization_id + external_id). Read-only — no
 * dialing or changes. Writes via the user's client → RLS-scoped.
 */
export async function syncSipuni(
  supabase: SupabaseClient,
  org: string,
): Promise<SipuniSyncSummary> {
  const { data: integration, error: intErr } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", org)
    .eq("provider", "sipuni")
    .maybeSingle();
  if (intErr) throw new Error(intErr.message);

  const config = (integration?.config ?? {}) as Partial<SipuniConfig>;
  if (!config.user_id || !config.api_key) {
    throw new SipuniConfigError(
      "Sipuni не подключён: сохраните ID пользователя и API-ключ на странице «Интеграции».",
    );
  }

  const client = createSipuniClient(config as SipuniConfig);
  const to = new Date();
  const from = new Date(to.getTime() - SIPUNI_WINDOW_DAYS * 86400000);

  const calls: SipuniCall[] = await client.getCalls(from, to);
  const before = await countCalls(supabase, org);

  const rows = calls.map((c) => ({
    organization_id: org,
    external_id: c.externalId,
    source: "sipuni" as const,
    direction: c.direction,
    from_number: c.fromNumber,
    to_number: c.toNumber,
    client_phone: c.clientPhone,
    manager: c.managerName,
    manager_name: c.managerName,
    manager_external_id: c.managerExternalId,
    duration_sec: c.durationSec,
    status: c.status,
    answered: c.answered,
    record_url: c.recordId,
    started_at: c.startedAt,
    raw: c.raw,
  }));

  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase
      .from("calls")
      .upsert(batch, { onConflict: "organization_id,external_id" });
    if (error) throw new Error(`Сохранение звонков: ${error.message}`);
  }

  await supabase
    .from("integrations")
    .update({ status: "CONNECTED", last_synced_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("provider", "sipuni");

  const after = await countCalls(supabase, org);
  const added = Math.max(0, after - before);
  const inbound = rows.filter((r) => r.direction === "in").length;
  const outbound = rows.filter((r) => r.direction === "out").length;
  const answered = rows.filter((r) => r.answered).length;
  const missed = rows.length - answered;
  console.log(
    `[sipuni] sync итог: добавлено=${added}, обработано=${rows.length}, входящих=${inbound}, ` +
      `исходящих=${outbound}, отвечено=${answered}, пропущено=${missed} (окно ${SIPUNI_WINDOW_DAYS} дн.)`,
  );

  return {
    total: rows.length,
    added,
    inbound,
    outbound,
    answered,
    missed,
    message:
      added > 0
        ? `Готово: добавлено ${added} новых звонков (обработано ${rows.length} за ${SIPUNI_WINDOW_DAYS} дн.).`
        : `Готово: новых звонков нет (обработано ${rows.length} за ${SIPUNI_WINDOW_DAYS} дн.).`,
  };
}

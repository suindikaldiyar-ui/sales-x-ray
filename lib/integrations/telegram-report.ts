import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCallsData, fmtDuration } from "@/lib/analytics/calls";
import { getConversationsData } from "@/lib/analytics/conversations";
import { fmtDate, fmtTime } from "@/lib/datetime";
import { createAdminClient } from "@/lib/supabase/admin";

export interface TelegramReportResult {
  sent: boolean;
  reason?: string;
  error?: string;
}

interface TelegramConfig {
  token: string;
  chatId: string;
}

/** True only when the whole system has a single organization (counted with the
 * service-role client so it doesn't depend on the caller's RLS scope). On any
 * error we return false — i.e. we DON'T allow the shared env fallback, the safe
 * default for a multi-tenant system. */
async function isSingleOrgSystem(): Promise<boolean> {
  try {
    const { count, error } = await createAdminClient()
      .from("organizations")
      .select("*", { count: "exact", head: true });
    if (error) return false;
    return (count ?? 0) <= 1;
  } catch {
    return false;
  }
}

/**
 * Resolve Telegram creds for an org. A per-org config (bot_token + chat_id in
 * integrations.telegram.config) is ALWAYS used when present. The shared global
 * env chat (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) is used ONLY as a fallback
 * when the system has exactly one organization — otherwise one org's report
 * could land in another org's chat. Multi-tenant systems must set per-org creds.
 */
async function resolveTelegram(
  supabase: SupabaseClient,
  org: string,
): Promise<TelegramConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", org)
    .eq("provider", "telegram")
    .maybeSingle();
  const cfg = (data?.config ?? {}) as { bot_token?: string; chat_id?: string };
  if (cfg.bot_token && cfg.chat_id) {
    return { token: cfg.bot_token, chatId: cfg.chat_id };
  }

  // No per-org config: only fall back to the shared env chat for a single-org
  // system, never when multiple organizations exist.
  const envToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const envChat = process.env.TELEGRAM_CHAT_ID || "";
  if (envToken && envChat && (await isSingleOrgSystem())) {
    return { token: envToken, chatId: envChat };
  }
  return null;
}

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build the daily report (period = today, Asia/Almaty) from existing analytics
 * and send it to Telegram (HTML). Never throws — returns a result the cron logs.
 * Token stays server-side.
 */
export async function sendTelegramReport(
  supabase: SupabaseClient,
  org: string,
): Promise<TelegramReportResult> {
  const tg = await resolveTelegram(supabase, org);
  if (!tg) {
    console.log(`[telegram report] org=${org} пропущен: не задан per-org telegram`);
    return { sent: false, reason: "не задан per-org telegram" };
  }

  try {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", org)
      .maybeSingle();
    const orgName = (orgRow?.name as string) || "Организация";

    const [calls, conv] = await Promise.all([
      getCallsData(supabase, org, { period: "today" }),
      getConversationsData(supabase, org, { period: "today" }),
    ]);

    const text = buildMessage(orgName, calls, conv);

    const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: tg.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram report] org=${org} -> ${res.status} ${body.slice(0, 300)}`);
      return { sent: false, error: `Telegram ${res.status}: ${body.slice(0, 160)}` };
    }
    console.log(`[telegram report] org=${org} отправлен ✓`);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telegram report] org=${org} error:`, message);
    return { sent: false, error: message };
  }
}

function buildMessage(
  orgName: string,
  calls: Awaited<ReturnType<typeof getCallsData>>,
  conv: Awaited<ReturnType<typeof getConversationsData>>,
): string {
  const L: string[] = [];
  L.push(`📊 <b>Sales X-Ray — отчёт за день</b>`);
  L.push(`🏢 ${esc(orgName)}`);
  L.push(`📅 ${esc(fmtDate(new Date()))}`);

  // ── 🔴 Where sales leak (the headline diagnostic) ─────────────────────────
  const missedPct = calls.total > 0 ? Math.round((calls.missed / calls.total) * 100) : 0;
  const lostContacts = calls.missed + conv.unansweredCount;
  L.push("");
  L.push(`🔴 <b>Где теряются продажи</b>`);
  if (calls.connected) {
    L.push(`⚠️ Пропущено звонков: <b>${calls.missed}</b> из ${calls.total} (${missedPct}%)`);
  }
  if (conv.synced) {
    L.push(`⚠️ Без ответа в переписке: <b>${conv.unansweredCount}</b>`);
    if (conv.avgFirstResponseMin != null) {
      const slow = conv.avgFirstResponseMin >= 15;
      L.push(`${slow ? "🐢" : "⚡️"} Медиана первого ответа: <b>${conv.avgFirstResponseMin} мин</b>`);
    }
  }
  L.push(`📉 Итого упущенных обращений: <b>${lostContacts}</b>`);

  // ── Calls ────────────────────────────────────────────────────────────────
  L.push("");
  if (calls.connected) {
    L.push(`📞 <b>Звонки</b>`);
    L.push(`Всего: <b>${calls.total}</b> (вх ${calls.inbound} / исх ${calls.outbound})`);
    L.push(`✅ Отвечено: ${calls.answered}   ⚠️ Пропущено: <b>${calls.missed}</b>`);
    L.push(`⏱ Ср. длительность: ${fmtDuration(calls.avgDurationSec)}`);

    const topManagers = calls.managers.slice(0, 8);
    if (topManagers.length) {
      L.push("");
      L.push(`👥 <b>Звонки по менеджерам</b>`);
      for (const m of topManagers) {
        const miss = m.missed > 0 ? `⚠️${m.missed}` : `0`;
        const mname = m.name === "Без ответственного" ? "Нет в amoCRM (новые номера)" : m.name;
        L.push(`• ${esc(mname)} — ✅${m.answered} / ${miss}`);
      }
    }
  } else {
    L.push(`📞 <b>Звонки</b>: Sipuni не подключён`);
  }

  // ── Conversations ─────────────────────────────────────────────────────────
  L.push("");
  if (conv.synced) {
    L.push(`💬 <b>Переписка</b>`);
    L.push(`Новых лидов: <b>${conv.newLeads}</b>`);
    L.push(`⚠️ Не отвечено: <b>${conv.unansweredCount}</b>`);
    L.push(
      `⏱ Медиана первого ответа: ${conv.avgFirstResponseMin != null ? conv.avgFirstResponseMin + " мин" : "—"}`,
    );
  } else {
    L.push(`💬 <b>Переписка</b>: Wazzup не подключён`);
  }

  // ── Needs attention ───────────────────────────────────────────────────────
  const missedCalls = calls.calls.filter((c) => !c.answered).slice(0, 5);
  const unanswered = conv.unanswered.slice(0, 5);
  if (missedCalls.length || unanswered.length) {
    L.push("");
    L.push(`⚠️ <b>Требуют внимания</b>`);
    if (missedCalls.length) {
      L.push(`<i>Пропущенные звонки:</i>`);
      for (const c of missedCalls) {
        L.push(`• ${esc(c.clientPhone ?? "—")} — ${esc(fmtTime(c.startedAt))}`);
      }
    }
    if (unanswered.length) {
      L.push(`<i>Без ответа в переписке:</i>`);
      for (const u of unanswered) {
        // Phone first (contactHandle = client phone from the Wazzup contact),
        // so the manager can find them in amoCRM/Wazzup; name as a fallback.
        const phone = u.contactHandle?.trim();
        const name = u.contactName?.trim();
        const label = phone ? (name ? `${phone} (${name})` : phone) : (name ?? "—");
        L.push(`• ${esc(label)}`);
      }
    }
  }

  return L.join("\n");
}

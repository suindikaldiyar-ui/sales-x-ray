import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCallsData, fmtDuration } from "@/lib/analytics/calls";
import { getConversationsData } from "@/lib/analytics/conversations";
import { fmtDate, fmtTime } from "@/lib/datetime";

export interface TelegramReportResult {
  sent: boolean;
  reason?: string;
  error?: string;
}

interface TelegramConfig {
  token: string;
  chatId: string;
}

/** Resolve Telegram creds: per-org integration first, then global env. */
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
  const token = cfg.bot_token || process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = cfg.chat_id || process.env.TELEGRAM_CHAT_ID || "";
  if (!token || !chatId) return null;
  return { token, chatId };
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
  if (!tg) return { sent: false, reason: "no telegram config" };

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
  L.push("");

  // ── Calls ────────────────────────────────────────────────────────────────
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
        L.push(`• ${esc(m.name)} — ✅${m.answered} / ${miss}`);
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
      `⏱ Ср. ответ: ${conv.avgFirstResponseMin != null ? conv.avgFirstResponseMin + " мин" : "—"}`,
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
        L.push(`• ${esc(u.contactName ?? u.contactHandle ?? "—")}`);
      }
    }
  }

  return L.join("\n");
}

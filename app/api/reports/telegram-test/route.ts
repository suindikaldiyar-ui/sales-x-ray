import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { sendTelegramReport } from "@/lib/integrations/telegram-report";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Manually send today's Telegram report for the caller's org — for testing
 * without waiting for the cron. OWNER only. Token stays server-side.
 */
export async function POST() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });
  if (tenant.role !== "OWNER") {
    return NextResponse.json(
      { ok: false, error: "Тестовую отправку может запускать только владелец." },
      { status: 403 },
    );
  }

  const supabase = createClient();
  const result = await sendTelegramReport(supabase, tenant.organization.id);
  if (!result.sent) {
    return NextResponse.json(
      { ok: false, error: result.error ?? result.reason ?? "Не отправлено." },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, sent: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import { sendTelegramReport } from "@/lib/integrations/telegram-report";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Manually send today's Telegram report for the caller's org — for testing and
 * on-demand sends (OWNER/ROP). Token stays server-side, scoped to the org.
 */
export async function POST() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { ok: false, error: "Отправку может запускать только владелец или РОП." },
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

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import {
  syncSipuni,
  SipuniConfigError,
  SIPUNI_MANUAL_WINDOW_DAYS,
} from "@/lib/integrations/sipuni-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Manual Sipuni sync (OWNER/ROP). Uses a SMALL window (default 2 days) so it
 * fits inside the 60s limit — the full 90-day history is pulled by the nightly
 * cron. An optional `days` in the body can widen it.
 */
export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { ok: false, error: "Синхронизацию может запускать только владелец или РОП." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const days = Number(body?.days) > 0 ? Number(body.days) : SIPUNI_MANUAL_WINDOW_DAYS;

  try {
    const supabase = createClient();
    const summary = await syncSipuni(supabase, tenant.organization.id, { days });
    return NextResponse.json({ ok: true, done: true, phase: "done", progress: 1, ...summary });
  } catch (err) {
    if (err instanceof SipuniConfigError) {
      return NextResponse.json({ ok: false, resumable: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Ошибка синхронизации Sipuni.";
    console.error("[sipuni] sync error:", message);
    return NextResponse.json({ ok: false, resumable: false, error: message }, { status: 200 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import { syncSipuni, SipuniConfigError } from "@/lib/integrations/sipuni-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Sync Sipuni call statistics for the active organization (OWNER/ROP). */
export async function POST() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { ok: false, error: "Синхронизацию может запускать только владелец или РОП." },
      { status: 403 },
    );
  }

  try {
    const supabase = createClient();
    const summary = await syncSipuni(supabase, tenant.organization.id);
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

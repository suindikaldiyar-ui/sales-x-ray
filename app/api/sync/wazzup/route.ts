import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import { syncWazzup, WazzupConfigError } from "@/lib/integrations/wazzup-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Sync Wazzup directories (channels + users) for the active organization.
 * Small and idempotent → completes in one call (returns done:true). Message
 * history is NOT available over REST; it is ingested via webhooks separately.
 */
export async function POST() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Не авторизовано." }, { status: 401 });
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { error: "Синхронизацию может запускать только владелец или РОП." },
      { status: 403 },
    );
  }

  try {
    const supabase = createClient();
    const summary = await syncWazzup(supabase, tenant.organization.id);
    return NextResponse.json({
      ok: true,
      done: true,
      phase: "done",
      progress: 1,
      message: summary.message,
      channels: summary.channels,
      users: summary.users,
    });
  } catch (err) {
    if (err instanceof WazzupConfigError) {
      return NextResponse.json({ ok: false, resumable: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Ошибка синхронизации Wazzup.";
    console.error("[sync wazzup] error:", message);
    return NextResponse.json({ ok: false, resumable: false, error: message }, { status: 200 });
  }
}

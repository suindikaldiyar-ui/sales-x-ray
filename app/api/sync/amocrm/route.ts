import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import { runSyncBatch, SyncConfigError } from "@/lib/integrations/amocrm-sync";

export const runtime = "nodejs";
export const maxDuration = 60; // each call is one bounded batch (soft deadline ~45s)
export const dynamic = "force-dynamic";

/**
 * Process ONE batch of the amoCRM sync for the active organization and return
 * progress. The client calls this repeatedly until `done`. Auth + role are
 * enforced here; the sync writes through the user's Supabase client so RLS
 * keeps it scoped to this organization.
 *
 *   body: { start?: boolean, full?: boolean }
 *     start — (re)build the catalog and reset the cursor
 *     full  — full 365-day history (default window is SYNC_WINDOW_DAYS / 30d)
 *
 * Transient amoCRM/network errors don't 500: the cursor is already persisted,
 * so we return a resumable status and the client retries the same call.
 */
export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Не авторизовано." }, { status: 401 });
  }
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { error: "Синхронизацию может запускать только владелец или РОП." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const start = Boolean(body?.start);
  const full = Boolean(body?.full);

  const supabase = createClient();

  try {
    const progress = await runSyncBatch(supabase, tenant.organization.id, { start, full });
    return NextResponse.json({ ok: true, ...progress });
  } catch (err) {
    // Config problems are not resumable → 400 with a clear message.
    if (err instanceof SyncConfigError) {
      console.error("[sync amocrm] config error:", err.message);
      return NextResponse.json({ ok: false, resumable: false, error: err.message }, { status: 400 });
    }
    // Everything else (rate limits, timeouts, network) is resumable: the
    // cursor is persisted, so the client can safely retry this call.
    const message = err instanceof Error ? err.message : "Ошибка синхронизации.";
    console.error("[sync amocrm] batch error (resumable):", message);
    try {
      await supabase
        .from("sync_state")
        .update({ status: "running", message, updated_at: new Date().toISOString() })
        .eq("organization_id", tenant.organization.id)
        .eq("provider", "amocrm");
    } catch {
      /* best-effort */
    }
    return NextResponse.json({ ok: false, resumable: true, error: message }, { status: 200 });
  }
}

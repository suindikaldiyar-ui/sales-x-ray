import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runIncrementalSync } from "@/lib/integrations/amocrm-cron";

export const runtime = "nodejs";
export const maxDuration = 60; // Hobby may cap lower; we bound work with a deadline
export const dynamic = "force-dynamic";

const MAX_ORGS = 25;
const SOFT_DEADLINE_MS = 50_000;

/**
 * Vercel Cron entry point: incrementally syncs amoCRM for every organization
 * with a connected integration. Protected by CRON_SECRET — Vercel attaches it
 * as `Authorization: Bearer <CRON_SECRET>` to scheduled requests. Errors per
 * org are isolated so one bad token can't stop the rest. Read-only w.r.t.
 * amoCRM (only pulls changed leads + catalog).
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "server not configured" }, { status: 500 });
  }

  const { data: rows } = await supabase
    .from("integrations")
    .select("organization_id")
    .eq("provider", "amocrm")
    .eq("status", "CONNECTED")
    .limit(MAX_ORGS);

  const orgIds = ((rows as any[]) ?? []).map((r) => r.organization_id as string);
  const deadline = Date.now() + SOFT_DEADLINE_MS;
  const results: any[] = [];

  for (const org of orgIds) {
    if (Date.now() >= deadline) {
      results.push({ organizationId: org, skipped: "deadline" });
      continue;
    }
    try {
      results.push(await runIncrementalSync(supabase, org, { deadline: Date.now() + 9000 }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron sync] org=${org} error:`, message);
      results.push({ organizationId: org, error: message });
    }
  }

  console.log(`[cron sync] обработано организаций: ${results.length}`);
  return NextResponse.json({ ok: true, count: results.length, results });
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}

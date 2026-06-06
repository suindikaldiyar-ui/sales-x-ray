import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { analyzeCall } from "@/lib/ai/call-analysis";
import { aiErrorResponse } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const callId = String(body?.callId ?? "");
  if (!callId) {
    return NextResponse.json({ ok: false, error: "Не указан звонок." }, { status: 400 });
  }

  try {
    const supabase = createClient();
    const result = await analyzeCall(supabase, tenant.organization.id, callId, {
      force: Boolean(body?.force),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

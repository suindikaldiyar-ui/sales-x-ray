import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { analyzeConversation } from "@/lib/ai/analyze";
import { aiErrorResponse } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversationId ?? "");
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Не указан диалог." }, { status: 400 });
  }

  try {
    const supabase = createClient();
    const result = await analyzeConversation(supabase, tenant.organization.id, conversationId, {
      force: Boolean(body?.force),
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

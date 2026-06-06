import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { transcribeMessage } from "@/lib/ai/transcribe";
import { aiErrorResponse } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const messageId = String(body?.messageId ?? "");
  if (!messageId) {
    return NextResponse.json({ ok: false, error: "Не указано сообщение." }, { status: 400 });
  }

  try {
    const supabase = createClient();
    const transcript = await transcribeMessage(supabase, tenant.organization.id, messageId, {
      force: Boolean(body?.force),
    });
    return NextResponse.json({ ok: true, transcript });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

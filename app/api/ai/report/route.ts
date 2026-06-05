import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import { generateAiReport } from "@/lib/ai/report";
import { aiErrorResponse } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { ok: false, error: "AI-отчёт может генерировать владелец или РОП." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  try {
    const supabase = createClient();
    const report = await generateAiReport(
      supabase,
      tenant.organization.id,
      { period: body?.period, from: body?.from, to: body?.to },
      { force: Boolean(body?.force) },
    );
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant, canManageIntegrations } from "@/lib/tenant";
import { analyzeConversation } from "@/lib/ai/analyze";
import { GeminiError } from "@/lib/ai/gemini";
import { aiErrorResponse } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 12;

/**
 * Analyze the most recent UNANSWERED conversations that have no cached analysis
 * yet. Bounded (BATCH_LIMIT) and stops early on a Gemini quota error, returning
 * how many were processed — so it never crashes or burns the quota blindly.
 */
export async function POST() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });
  if (!canManageIntegrations(tenant.role)) {
    return NextResponse.json(
      { ok: false, error: "Пакетный анализ доступен владельцу или РОПу." },
      { status: 403 },
    );
  }

  const org = tenant.organization.id;
  const supabase = createClient();

  // Recent unanswered dialogs (client wrote last).
  const { data: convs } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", org)
    .eq("source", "wazzup")
    .eq("last_message_inbound", true)
    .order("last_message_at", { ascending: false })
    .limit(40);
  const ids = ((convs as any[]) ?? []).map((c) => c.id as string);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, analyzed: 0, message: "Нет неотвеченных диалогов." });
  }

  // Skip ones already analyzed.
  const { data: done } = await supabase
    .from("conversation_analysis")
    .select("conversation_id")
    .eq("organization_id", org)
    .in("conversation_id", ids);
  const analyzedSet = new Set(((done as any[]) ?? []).map((d) => d.conversation_id));
  const todo = ids.filter((id) => !analyzedSet.has(id)).slice(0, BATCH_LIMIT);

  let analyzed = 0;
  try {
    for (const id of todo) {
      await analyzeConversation(supabase, org, id);
      analyzed += 1;
    }
  } catch (err) {
    if (err instanceof GeminiError) {
      // Return partial progress with a clear note instead of failing the lot.
      return NextResponse.json({
        ok: true,
        analyzed,
        message: `Проанализировано ${analyzed}. Остановлено: ${err.message}`,
      });
    }
    return aiErrorResponse(err);
  }

  return NextResponse.json({
    ok: true,
    analyzed,
    message: `Проанализировано диалогов: ${analyzed}.`,
  });
}

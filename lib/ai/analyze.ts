import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callGemini, parseJsonResponse } from "./gemini";
import { requireGeminiKey } from "./settings";

export type Interest = "high" | "medium" | "low" | "cold";
export type Objections = "yes" | "no" | "partial";

export interface ConversationAnalysis {
  interest: Interest;
  closing: boolean;
  objections: Objections;
  response_speed: string;
  summary: string;
  recommendation: string;
}

const SYSTEM = `Ты — старший аналитик отдела продаж (автосалон). Ты разбираешь переписку менеджера с клиентом. Диалоги могут быть на русском или казахском языке — понимай оба. Отвечай кратко, по делу, без воды. Возвращай СТРОГО JSON без пояснений и без markdown.`;

function buildPrompt(transcript: string): string {
  return `Проанализируй диалог менеджера с клиентом и верни JSON ровно такого вида:
{
  "interest": "high" | "medium" | "low" | "cold",   // интерес клиента (cold = остыл)
  "closing": true | false,                            // менеджер сделал попытку закрытия сделки?
  "objections": "yes" | "no" | "partial",            // отработал ли возражения
  "response_speed": "строка",                        // краткая оценка скорости ответа менеджера (на русском)
  "summary": "строка",                               // краткий итог диалога, 1-2 предложения (на русском)
  "recommendation": "строка"                         // 1 конкретная рекомендация менеджеру (на русском)
}

Диалог (──> сообщение менеджера, <── сообщение клиента):
${transcript}`;
}

interface MsgRow {
  direction: string | null;
  author_name: string | null;
  body: string | null;
  sent_at: string | null;
}

function normalize(raw: any): ConversationAnalysis {
  const interest: Interest = ["high", "medium", "low", "cold"].includes(raw?.interest)
    ? raw.interest
    : "medium";
  const objections: Objections = ["yes", "no", "partial"].includes(raw?.objections)
    ? raw.objections
    : "no";
  return {
    interest,
    closing: Boolean(raw?.closing),
    objections,
    response_speed: String(raw?.response_speed ?? "—").slice(0, 200),
    summary: String(raw?.summary ?? "—").slice(0, 800),
    recommendation: String(raw?.recommendation ?? "—").slice(0, 800),
  };
}

/**
 * Analyze one conversation via Gemini and cache the result. Re-uses the cached
 * analysis unless `force` is set, so we never re-spend quota needlessly.
 */
export async function analyzeConversation(
  supabase: SupabaseClient,
  org: string,
  conversationId: string,
  opts: { force?: boolean } = {},
): Promise<ConversationAnalysis> {
  if (!opts.force) {
    const { data: cached } = await supabase
      .from("conversation_analysis")
      .select("result")
      .eq("organization_id", org)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (cached?.result && Object.keys(cached.result).length > 0) {
      return cached.result as ConversationAnalysis;
    }
  }

  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, author_name, body, sent_at")
    .eq("organization_id", org)
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .limit(200);

  const rows = (msgs as MsgRow[]) ?? [];
  if (rows.length === 0) {
    throw new Error("В диалоге нет сообщений для анализа.");
  }

  const transcript = rows
    .map((m) => {
      const who = m.direction === "in" ? "<──" : "──>";
      const name = m.direction === "in" ? "Клиент" : m.author_name ?? "Менеджер";
      return `${who} ${name}: ${(m.body ?? "").replace(/\s+/g, " ").slice(0, 500)}`;
    })
    .join("\n");

  const { apiKey, model } = await requireGeminiKey(supabase, org);
  const text = await callGemini(apiKey, model, {
    system: SYSTEM,
    prompt: buildPrompt(transcript),
    json: true,
    label: `analyze-conversation org=${org}`,
  });

  const result = normalize(parseJsonResponse<any>(text));

  await supabase.from("conversation_analysis").upsert(
    {
      organization_id: org,
      conversation_id: conversationId,
      result,
      model,
      created_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,conversation_id" },
  );

  return result;
}

/** Cached analyses for a set of conversations (for list display). */
export async function getCachedAnalyses(
  supabase: SupabaseClient,
  org: string,
  conversationIds: string[],
): Promise<Map<string, ConversationAnalysis>> {
  const out = new Map<string, ConversationAnalysis>();
  if (conversationIds.length === 0) return out;
  const { data } = await supabase
    .from("conversation_analysis")
    .select("conversation_id, result")
    .eq("organization_id", org)
    .in("conversation_id", conversationIds);
  for (const r of (data as any[]) ?? []) {
    if (r.result) out.set(r.conversation_id, r.result as ConversationAnalysis);
  }
  return out;
}

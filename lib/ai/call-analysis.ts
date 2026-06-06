import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callGemini, parseJsonResponse } from "./gemini";
import { requireGeminiKey } from "./settings";
import { createSipuniClient, type SipuniConfig } from "@/lib/integrations/sipuni";

export type Interest = "high" | "medium" | "low" | "cold";

export interface CallAnalysis {
  interest: Interest;
  objections: string;
  did_well: string;
  did_poorly: string;
  outcome: string;
  recommendation: string;
  summary: string;
}

export interface CallAnalysisResult {
  transcript: string;
  analysis: CallAnalysis;
  cached: boolean;
}

// Inline-audio request cap (base64 ≈ 4/3 of bytes; keep well under ~20 MB).
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

const TRANSCRIBE_PROMPT =
  "Расшифруй этот телефонный разговор между менеджером отдела продаж и клиентом дословно. " +
  "Раздели реплики по ролям в формате «Менеджер: …» и «Клиент: …» (каждая реплика с новой строки). " +
  "Язык может быть казахский или русский — сохрани язык оригинала. Верни только текст расшифровки.";

const ANALYSIS_SYSTEM =
  "Ты — руководитель отдела продаж. Разбираешь телефонный разговор менеджера с клиентом. " +
  "Отвечай кратко, по делу, на русском. Возвращай СТРОГО JSON без markdown.";

function analysisPrompt(transcript: string): string {
  return `Проанализируй продажный звонок по транскрипту и верни JSON ровно такого вида:
{
  "interest": "high" | "medium" | "low" | "cold",  // интерес клиента (cold = остыл)
  "objections": "строка",                           // ключевые возражения клиента (или «нет»)
  "did_well": "строка",                             // что менеджер сделал хорошо
  "did_poorly": "строка",                           // что сделал плохо / упустил
  "outcome": "строка",                              // движется ли сделка и ПОЧЕМУ
  "recommendation": "строка",                       // 1 конкретная рекомендация менеджеру
  "summary": "строка"                               // краткий итог звонка, 1-2 предложения
}

Транскрипт звонка:
${transcript}`;
}

function normalize(raw: any): CallAnalysis {
  const interest: Interest = ["high", "medium", "low", "cold"].includes(raw?.interest)
    ? raw.interest
    : "medium";
  const s = (v: unknown, fallback = "—") => String(v ?? fallback).slice(0, 1000) || fallback;
  return {
    interest,
    objections: s(raw?.objections),
    did_well: s(raw?.did_well),
    did_poorly: s(raw?.did_poorly),
    outcome: s(raw?.outcome),
    recommendation: s(raw?.recommendation),
    summary: s(raw?.summary),
  };
}

/** Cached transcript + analysis for a call, or null. */
export async function getCachedCallAnalysis(
  supabase: SupabaseClient,
  org: string,
  callId: string,
): Promise<CallAnalysisResult | null> {
  const { data } = await supabase
    .from("call_analysis")
    .select("transcript, analysis")
    .eq("organization_id", org)
    .eq("call_id", callId)
    .maybeSingle();
  if (data?.analysis && Object.keys(data.analysis).length > 0) {
    return { transcript: data.transcript ?? "", analysis: data.analysis as CallAnalysis, cached: true };
  }
  return null;
}

/**
 * Transcribe + analyze a Sipuni call recording via Gemini, caching both. Reuses
 * the cached result unless `force`. RLS-scoped via the passed client (call must
 * belong to the caller's org); the Sipuni key stays server-side.
 */
export async function analyzeCall(
  supabase: SupabaseClient,
  org: string,
  callId: string,
  opts: { force?: boolean } = {},
): Promise<CallAnalysisResult> {
  if (!opts.force) {
    const cached = await getCachedCallAnalysis(supabase, org, callId);
    if (cached) return cached;
  }

  const { data: call } = await supabase
    .from("calls")
    .select("record_id, has_record")
    .eq("organization_id", org)
    .eq("id", callId)
    .maybeSingle();
  if (!call) throw new Error("Звонок не найден.");
  if (!call.record_id) throw new Error("У звонка нет записи для анализа.");

  const { data: integ } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", org)
    .eq("provider", "sipuni")
    .maybeSingle();
  const config = (integ?.config ?? {}) as Partial<SipuniConfig>;
  if (!config.user_id || !config.api_key) {
    throw new Error("Sipuni не подключён.");
  }

  // 1) Download the recording (server-side, авторизованный POST к Sipuni).
  const sipuni = createSipuniClient(config as SipuniConfig);
  const { data: audio, contentType } = await sipuni.getRecordById(String(call.record_id));
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error("Запись слишком длинная для анализа (ограничение размера).");
  }
  const base64 = Buffer.from(audio).toString("base64");
  const { apiKey, model } = await requireGeminiKey(supabase, org);

  // 2) Transcription (audio → text with speaker roles).
  const transcript = (
    await callGemini(apiKey, model, {
      prompt: TRANSCRIBE_PROMPT,
      audio: { data: base64, mimeType: contentType.includes("audio") ? contentType : "audio/mpeg" },
      temperature: 0,
      label: `call-analysis transcribe org=${org} call=${callId}`,
    })
  ).trim();

  // 3) Sales analysis of the transcript (JSON).
  const analysisText = await callGemini(apiKey, model, {
    system: ANALYSIS_SYSTEM,
    prompt: analysisPrompt(transcript),
    json: true,
    temperature: 0.3,
    label: `call-analysis analyze org=${org} call=${callId}`,
  });
  const analysis = normalize(parseJsonResponse<any>(analysisText));

  await supabase.from("call_analysis").upsert(
    {
      organization_id: org,
      call_id: callId,
      transcript,
      analysis,
      model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,call_id" },
  );

  return { transcript, analysis, cached: false };
}

/** Call ids that already have a cached analysis (for list indicators). */
export async function getAnalyzedCallIds(
  supabase: SupabaseClient,
  org: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("call_analysis")
    .select("call_id")
    .eq("organization_id", org);
  return new Set(((data as any[]) ?? []).map((r) => r.call_id as string));
}

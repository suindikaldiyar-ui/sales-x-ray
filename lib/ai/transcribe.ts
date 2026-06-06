import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callGemini, GeminiError } from "./gemini";
import { requireGeminiKey } from "./settings";

const PROMPT =
  "Расшифруй это голосовое сообщение дословно. Язык может быть казахский или русский. Верни только текст расшифровки, без пояснений и кавычек.";

// Keep inline audio well under the request limit (~20 MB base64).
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

/**
 * Transcribe a voice/audio message via Gemini and cache the result on the
 * message row. Re-uses the cached transcript unless `force`.
 */
export async function transcribeMessage(
  supabase: SupabaseClient,
  org: string,
  messageId: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  const { data: msg } = await supabase
    .from("messages")
    .select("media_url, message_type, transcript")
    .eq("organization_id", org)
    .eq("id", messageId)
    .maybeSingle();

  if (!msg) throw new Error("Сообщение не найдено.");
  if (!opts.force && msg.transcript) return msg.transcript as string;

  const url = msg.media_url as string | null;
  if (!url) {
    throw new Error("У сообщения нет ссылки на аудио (media_url пуст).");
  }

  // Download the audio file.
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    console.error("[gemini transcribe] download network error:", e);
    throw new Error("Не удалось скачать аудио по ссылке.");
  }
  console.log(`[gemini transcribe] download ${url.slice(0, 80)} -> ${res.status} ${res.headers.get("content-type")}`);
  if (res.status === 401 || res.status === 403) {
    throw new Error("Ссылка на аудио требует авторизации (401/403) — Gemini не сможет её скачать.");
  }
  if (!res.ok) {
    throw new Error(`Не удалось получить аудио (${res.status}).`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new Error("Аудио слишком большое для расшифровки.");
  }
  const mimeType = (res.headers.get("content-type") || "audio/ogg").split(";")[0].trim();
  const data = buf.toString("base64");

  const { apiKey, model } = await requireGeminiKey(supabase, org);
  const text = await callGemini(apiKey, model, {
    prompt: PROMPT,
    audio: { data, mimeType },
    temperature: 0,
    label: `transcribe org=${org} msg=${messageId}`,
  });

  const transcript = text.trim();
  await supabase
    .from("messages")
    .update({ transcript })
    .eq("organization_id", org)
    .eq("id", messageId);

  return transcript;
}

export { GeminiError };

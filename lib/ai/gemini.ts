import "server-only";

/** Default text model; override with GEMINI_MODEL (e.g. a newer Flash). */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Friendly error so routes can return a clear message (and never crash). */
export class GeminiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiCallOptions {
  /** System instruction (role/behaviour). */
  system?: string;
  /** User prompt. */
  prompt: string;
  /** Ask Gemini to return strict JSON (responseMimeType: application/json). */
  json?: boolean;
  temperature?: number;
  /** Where the call came from — for logs. */
  label?: string;
}

/**
 * Single server-side entry point to Gemini's generateContent REST API. Handles
 * rate limits / quota (429) and auth/model errors (400/403) with clear
 * messages, and logs every call. Returns the model's text output.
 */
export async function callGemini(
  apiKey: string,
  model: string,
  opts: GeminiCallOptions,
): Promise<string> {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    console.error(`[gemini] ${opts.label ?? "call"} model=${model} network error:`, e);
    throw new GeminiError(0, "Не удалось связаться с Gemini (сеть).");
  }

  if (res.status === 429) {
    console.error(`[gemini] ${opts.label ?? "call"} model=${model} -> 429 (quota)`);
    throw new GeminiError(429, "Лимит/квота Gemini исчерпаны. Попробуйте позже или проверьте биллинг ключа.");
  }
  if (res.status === 400 || res.status === 403) {
    const txt = await res.text().catch(() => "");
    console.error(`[gemini] ${opts.label ?? "call"} model=${model} -> ${res.status} ${txt.slice(0, 300)}`);
    throw new GeminiError(
      res.status,
      "Gemini отклонил запрос: проверьте API-ключ и доступность модели (GEMINI_MODEL).",
    );
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[gemini] ${opts.label ?? "call"} model=${model} -> ${res.status} ${txt.slice(0, 300)}`);
    throw new GeminiError(res.status, `Ошибка Gemini (${res.status}).`);
  }

  const data = (await res.json()) as any;
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  console.log(
    `[gemini] ${opts.label ?? "call"} model=${model} ok in ${Date.now() - started}ms, ${text.length} chars`,
  );
  if (!text) {
    throw new GeminiError(502, "Gemini вернул пустой ответ.");
  }
  return text;
}

/** Parse a JSON object out of a model response (tolerates code fences). */
export function parseJsonResponse<T>(text: string): T {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}

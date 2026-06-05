import "server-only";

/** Default text model; override with GEMINI_MODEL. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Per-process cache of the model that actually worked for a given key, so we
 * don't re-list models on every call after a one-time fallback. */
const resolvedModelByKey = new Map<string, string>();

/** Friendly error so routes can return a clear message (and never crash). */
export class GeminiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly model?: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiCallOptions {
  system?: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  label?: string;
}

interface ListedModel {
  name: string; // without the "models/" prefix
  methods: string[];
}

/** GET /v1beta/models — the models actually available to this key. */
async function listModels(apiKey: string): Promise<ListedModel[]> {
  try {
    const res = await fetch(`${BASE}/models?pageSize=200&key=${apiKey}`, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[gemini] ListModels -> ${res.status}`);
      return [];
    }
    const data = (await res.json()) as any;
    return (data?.models ?? []).map((m: any) => ({
      name: String(m.name ?? "").replace(/^models\//, ""),
      methods: m.supportedGenerationMethods ?? [],
    }));
  } catch (e) {
    console.error("[gemini] ListModels network error:", e);
    return [];
  }
}

/** Choose the best available model: preferred → any 2.5 flash → 1.5 flash → any. */
function pickModel(models: ListedModel[], preferred: string): string | null {
  const usable = models.filter((m) => m.methods.includes("generateContent")).map((m) => m.name);
  console.log(`[gemini] доступные модели: ${usable.join(", ") || "(пусто)"}`);
  if (usable.length === 0) return null;

  if (usable.includes(preferred)) return preferred;
  // Prefer a stable "gemini-2.5-flash", then any 2.5 flash (incl. preview).
  const stable25 = usable.find((n) => n === "gemini-2.5-flash");
  if (stable25) return stable25;
  const any25 = usable.find((n) => /gemini-2\.5.*flash/.test(n) && !/thinking/.test(n));
  if (any25) return any25;
  const any25any = usable.find((n) => /gemini-2\.5.*flash/.test(n));
  if (any25any) return any25any;
  const any15 = usable.find((n) => /gemini-1\.5.*flash/.test(n));
  if (any15) return any15;
  const anyFlash = usable.find((n) => /flash/.test(n));
  return anyFlash ?? usable[0];
}

function buildBody(opts: GeminiCallOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  return body;
}

async function postGenerate(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/**
 * Single server-side entry point to Gemini's generateContent REST API
 * (v1beta). Defaults to gemini-2.5-flash; if the model 404s for this key, it
 * lists the key's available models (logging them), picks a suitable
 * 2.5/1.5 flash and retries — caching the working model. Handles 429/quota and
 * auth errors with clear messages, and logs every call.
 */
export async function callGemini(
  apiKey: string,
  model: string,
  opts: GeminiCallOptions,
): Promise<string> {
  const body = buildBody(opts);
  const started = Date.now();
  let used = resolvedModelByKey.get(apiKey) ?? model;

  let res: Response;
  try {
    res = await postGenerate(apiKey, used, body);
  } catch (e) {
    console.error(`[gemini] ${opts.label ?? "call"} model=${used} network error:`, e);
    throw new GeminiError(0, "Не удалось связаться с Gemini (сеть).", used);
  }

  // Model not found / not available for this key → discover and retry once.
  if (res.status === 404) {
    console.error(`[gemini] ${opts.label ?? "call"} model=${used} -> 404 (не найдена)`);
    const chosen = pickModel(await listModels(apiKey), model);
    if (chosen && chosen !== used) {
      console.log(`[gemini] переключаюсь на доступную модель: ${chosen}`);
      resolvedModelByKey.set(apiKey, chosen);
      used = chosen;
      try {
        res = await postGenerate(apiKey, used, body);
      } catch (e) {
        console.error(`[gemini] retry model=${used} network error:`, e);
        throw new GeminiError(0, "Не удалось связаться с Gemini (сеть).", used);
      }
    } else {
      throw new GeminiError(
        404,
        `Модель «${model}» недоступна для этого ключа. Задайте GEMINI_MODEL из доступных (см. логи).`,
        model,
      );
    }
  }

  if (res.status === 429) {
    console.error(`[gemini] ${opts.label ?? "call"} model=${used} -> 429 (quota)`);
    throw new GeminiError(429, "Лимит/квота Gemini исчерпаны. Попробуйте позже или проверьте биллинг ключа.", used);
  }
  if (res.status === 400 || res.status === 403) {
    const txt = await res.text().catch(() => "");
    console.error(`[gemini] ${opts.label ?? "call"} model=${used} -> ${res.status} ${txt.slice(0, 300)}`);
    throw new GeminiError(
      res.status,
      `Gemini отклонил запрос (модель «${used}»): проверьте API-ключ и доступность модели.`,
      used,
    );
  }
  if (res.status === 404) {
    throw new GeminiError(404, `Модель «${used}» недоступна для этого ключа.`, used);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[gemini] ${opts.label ?? "call"} model=${used} -> ${res.status} ${txt.slice(0, 300)}`);
    throw new GeminiError(res.status, `Ошибка Gemini (${res.status}, модель «${used}»).`, used);
  }

  const data = (await res.json()) as any;
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  console.log(
    `[gemini] ${opts.label ?? "call"} model=${used} ok in ${Date.now() - started}ms, ${text.length} chars`,
  );
  if (!text) throw new GeminiError(502, `Gemini вернул пустой ответ (модель «${used}»).`, used);
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

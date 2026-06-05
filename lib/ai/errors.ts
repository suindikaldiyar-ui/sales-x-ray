import { NextResponse } from "next/server";
import { GeminiError } from "./gemini";
import { AiUnavailable } from "./settings";

/** Map AI errors to a clean JSON response (never a 500 crash). */
export function aiErrorResponse(err: unknown): NextResponse {
  if (err instanceof AiUnavailable) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
  if (err instanceof GeminiError) {
    const status = err.status === 429 ? 429 : err.status >= 400 && err.status < 500 ? 400 : 502;
    return NextResponse.json({ ok: false, error: err.message }, { status });
  }
  const message = err instanceof Error ? err.message : "Ошибка AI-анализа.";
  console.error("[ai] unexpected error:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

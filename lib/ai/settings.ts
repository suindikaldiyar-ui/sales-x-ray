import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GEMINI_MODEL } from "./gemini";

export interface AiStatus {
  /** Toggle is on AND a key is available (per-org or global env). */
  ready: boolean;
  enabled: boolean;
  /** A usable key exists (per-org BYOK or global env) — never the key itself. */
  hasKey: boolean;
  /** True when the key comes from the global env, not the org. */
  usingGlobalKey: boolean;
  model: string;
}

/**
 * Resolve the org's AI config for the CLIENT (no secrets). `enabled` is the
 * org toggle; the effective key is the per-org BYOK key, falling back to the
 * global GEMINI_API_KEY env.
 */
export async function getAiStatus(
  supabase: SupabaseClient,
  org: string,
): Promise<AiStatus> {
  const { data } = await supabase
    .from("ai_settings")
    .select("gemini_api_key, enabled")
    .eq("organization_id", org)
    .maybeSingle();

  const orgKey = (data?.gemini_api_key as string | null) ?? null;
  const envKey = process.env.GEMINI_API_KEY ?? null;
  const hasKey = Boolean(orgKey || envKey);
  // Default ON when no row yet, so AI works out of the box with a global key.
  const enabled = data?.enabled ?? true;

  return {
    ready: enabled && hasKey,
    enabled,
    hasKey,
    usingGlobalKey: !orgKey && Boolean(envKey),
    model: GEMINI_MODEL,
  };
}

/** Resolve the effective API key (server-only). Throws if AI is unavailable. */
export async function requireGeminiKey(
  supabase: SupabaseClient,
  org: string,
): Promise<{ apiKey: string; model: string }> {
  const { data } = await supabase
    .from("ai_settings")
    .select("gemini_api_key, enabled")
    .eq("organization_id", org)
    .maybeSingle();

  const enabled = data?.enabled ?? true;
  if (!enabled) {
    throw new AiUnavailable("AI-анализ выключен в настройках организации.");
  }
  const apiKey = (data?.gemini_api_key as string | null) || process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new AiUnavailable("Не задан Gemini API-ключ. Добавьте его в Настройках → AI.");
  }
  return { apiKey, model: GEMINI_MODEL };
}

export class AiUnavailable extends Error {}

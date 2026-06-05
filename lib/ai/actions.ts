"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/tenant";

export interface AiSettingsState {
  error?: string;
  message?: string;
}

/**
 * Save the org's AI settings (OWNER/ROP). The Gemini key is write-only from the
 * UI — an empty key field keeps the stored one. `enabled` toggles the feature.
 */
export async function saveAiSettingsAction(
  _prev: AiSettingsState,
  formData: FormData,
): Promise<AiSettingsState> {
  const { organization } = await requireRole(["OWNER", "ROP"]);
  const supabase = createClient();

  const enabled = formData.get("enabled") === "on";
  const newKey = String(formData.get("gemini_api_key") ?? "").trim();

  const { data: existing } = await supabase
    .from("ai_settings")
    .select("gemini_api_key")
    .eq("organization_id", organization.id)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    organization_id: organization.id,
    enabled,
  };
  if (newKey) payload.gemini_api_key = newKey;
  else if (existing) payload.gemini_api_key = existing.gemini_api_key;

  const { error } = await supabase
    .from("ai_settings")
    .upsert(payload, { onConflict: "organization_id" });
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/conversations");
  revalidatePath("/reports");
  return { message: "Настройки AI сохранены." };
}

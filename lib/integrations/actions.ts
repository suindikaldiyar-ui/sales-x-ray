"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/tenant";
import { getCatalogEntry } from "./catalog";
import { getConnector } from "./index";
import type { IntegrationProvider } from "@/lib/types/db";

export interface IntegrationActionState {
  error?: string;
  message?: string;
}

/**
 * Save per-organization credentials for a provider. Only OWNER/ROP, enforced by
 * both requireRole and the integrations RLS policy. Secrets are written but
 * never read back to the browser. Real sync is wired in later, so status flips
 * to CONNECTED purely on the presence of required fields.
 */
export async function saveIntegrationAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const provider = String(formData.get("provider") ?? "") as IntegrationProvider;
  const entry = getCatalogEntry(provider);
  if (!entry) return { error: "Неизвестная интеграция." };

  const { organization } = await requireRole(["OWNER", "ROP"]);

  // Read existing config so empty password fields keep their stored value.
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", organization.id)
    .eq("provider", provider)
    .maybeSingle();

  const prevConfig = (existing?.config as Record<string, unknown>) ?? {};
  const config: Record<string, unknown> = { ...prevConfig };

  for (const field of entry.configFields) {
    const raw = formData.get(field.key);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      config[field.key] = value;
    } else if (field.required && field.type !== "password") {
      return { error: `Поле «${field.label}» обязательно.` };
    }
    // Empty password field → keep the previously stored secret.
  }

  const hasAllRequired = entry.configFields.every(
    (f) => !f.required || Boolean(config[f.key]),
  );

  const { error } = await supabase
    .from("integrations")
    .update({
      config,
      status: hasAllRequired ? "CONNECTED" : "NOT_CONNECTED",
    })
    .eq("organization_id", organization.id)
    .eq("provider", provider);

  if (error) return { error: error.message };

  revalidatePath("/integrations");
  return { message: `${entry.label}: настройки сохранены.` };
}

/**
 * Test a provider connection using the stored (server-side) credentials.
 * Returns a human message; never exposes the secret to the client.
 */
export async function testIntegrationAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const provider = String(formData.get("provider") ?? "") as IntegrationProvider;
  const { organization } = await requireRole(["OWNER", "ROP"]);
  const supabase = createClient();
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", organization.id)
    .eq("provider", provider)
    .maybeSingle();

  const config = (data?.config as Record<string, unknown>) ?? {};
  const connector = getConnector(provider);
  if (!connector.validateConfig(config)) {
    return { error: "Сначала сохраните ключи интеграции." };
  }
  const result = await connector.testConnection(config as any);
  return result.connected
    ? { message: result.message }
    : { error: result.message };
}

/** Disconnect a provider: clear its config and reset status. */
export async function disconnectIntegrationAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "") as IntegrationProvider;
  const { organization } = await requireRole(["OWNER", "ROP"]);
  const supabase = createClient();
  await supabase
    .from("integrations")
    .update({ config: {}, status: "NOT_CONNECTED", last_synced_at: null })
    .eq("organization_id", organization.id)
    .eq("provider", provider);
  revalidatePath("/integrations");
}

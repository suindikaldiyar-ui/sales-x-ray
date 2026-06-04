import { createClient } from "@/lib/supabase/server";
import type { Integration, IntegrationProvider } from "@/lib/types/db";

/** All integration rows for an organization (RLS scopes this to members). */
export async function getIntegrations(
  organizationId: string,
): Promise<Integration[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("integrations")
    .select("*")
    .eq("organization_id", organizationId);
  return (data as Integration[]) ?? [];
}

export async function isProviderConnected(
  organizationId: string,
  provider: IntegrationProvider,
): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("integrations")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();
  return data?.status === "CONNECTED";
}

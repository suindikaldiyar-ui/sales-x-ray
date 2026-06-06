import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SipuniManager {
  extension: string;
  name: string;
}

/** extension → name map for resolving Sipuni call managers. */
export async function getSipuniManagerMap(
  supabase: SupabaseClient,
  org: string,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("sipuni_manager_map")
    .select("extension, name")
    .eq("organization_id", org);
  const map = new Map<string, string>();
  for (const r of (data as SipuniManager[]) ?? []) {
    if (r.extension) map.set(String(r.extension).trim(), r.name);
  }
  return map;
}

export async function getSipuniManagers(
  supabase: SupabaseClient,
  org: string,
): Promise<SipuniManager[]> {
  const { data } = await supabase
    .from("sipuni_manager_map")
    .select("extension, name")
    .eq("organization_id", org)
    .order("extension", { ascending: true });
  return (data as SipuniManager[]) ?? [];
}

/** Distinct manager codes seen in calls that are NOT yet mapped (for the editor
 * hint). The code may be a bare extension ("205") or "205 Менеджер 2". */
export async function getUnmappedManagerCodes(
  supabase: SupabaseClient,
  org: string,
  mapped: Map<string, string>,
): Promise<string[]> {
  const { data } = await supabase
    .from("calls")
    .select("manager_external_id")
    .eq("organization_id", org)
    .eq("source", "sipuni")
    .not("manager_external_id", "is", null)
    .limit(5000);
  const seen = new Set<string>();
  for (const r of (data as any[]) ?? []) {
    const raw = String(r.manager_external_id ?? "").trim();
    const ext = extractExtension(raw);
    if (ext && !mapped.has(ext)) seen.add(ext);
  }
  return [...seen].sort();
}

/** Pull the leading extension from a manager code like "205" or "205 Имя". */
export function extractExtension(code: string | null | undefined): string {
  const s = String(code ?? "").trim();
  const m = s.match(/^(\d{2,6})\b/);
  return m ? m[1] : s;
}

/** Resolve a raw manager code to a display name via the map (fallback to code). */
export function resolveManagerName(
  rawCode: string | null,
  map: Map<string, string>,
): string {
  if (!rawCode) return "Без ответственного";
  const ext = extractExtension(rawCode);
  return map.get(ext) ?? map.get(rawCode.trim()) ?? rawCode;
}

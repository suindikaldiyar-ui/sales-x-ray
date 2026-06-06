import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmoContact } from "./amocrm";

/** Normalize a phone to its last 10 digits (so +7701…, 8701…, 7701… match). */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Upsert (phone_norm → responsible_user_id) for a batch of contacts. One row per
 * normalized phone (last write wins). Returns how many phone rows were written.
 */
export async function upsertContactPhones(
  supabase: SupabaseClient,
  org: string,
  contacts: AmoContact[],
): Promise<number> {
  const byPhone = new Map<string, number>();
  for (const c of contacts) {
    if (c.responsibleUserId == null) continue;
    for (const ph of c.phones) {
      const n = normalizePhone(ph);
      if (n) byPhone.set(n, c.responsibleUserId);
    }
  }
  const rows = [...byPhone.entries()].map(([phone_norm, responsible_user_id]) => ({
    organization_id: org,
    phone_norm,
    responsible_user_id,
  }));
  if (rows.length === 0) return 0;
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase
      .from("amocrm_phones")
      .upsert(batch, { onConflict: "organization_id,phone_norm" });
    if (error) throw new Error(`Сохранение телефонов: ${error.message}`);
  }
  return rows.length;
}

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually (no dotenv dep needed).
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: orgs } = await sb.from("organizations").select("id, name").order("name");
console.log("\n=== ORGANIZATIONS ===");
for (const o of orgs ?? []) console.log(`${o.id}  ${o.name}`);

console.log("\n=== CALLS per organization_id (source=sipuni) ===");
for (const o of orgs ?? []) {
  const { count } = await sb
    .from("calls")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", o.id)
    .eq("source", "sipuni");
  console.log(`${o.name.padEnd(24)} ${o.id}  calls=${count}`);
}

console.log("\n=== SIPUNI integration config (user_id only, NO api_key) ===");
const { data: ints } = await sb
  .from("integrations")
  .select("organization_id, status, config")
  .eq("provider", "sipuni");
const orgName = Object.fromEntries((orgs ?? []).map((o) => [o.id, o.name]));
for (const i of ints ?? []) {
  const cfg = i.config ?? {};
  const apiLen = cfg.api_key ? String(cfg.api_key).length : 0;
  const apiTail = cfg.api_key ? String(cfg.api_key).slice(-4) : "—";
  console.log(
    `${(orgName[i.organization_id] ?? i.organization_id).padEnd(24)} status=${i.status} ` +
      `user_id=${cfg.user_id ?? "—"} api_key.len=${apiLen} api_key.tail=${apiTail}`,
  );
}

console.log("\n=== Sample calls per org (5 newest: external_id, phone, started_at) ===");
for (const o of orgs ?? []) {
  const { data } = await sb
    .from("calls")
    .select("external_id, client_phone, from_number, to_number, started_at")
    .eq("organization_id", o.id)
    .eq("source", "sipuni")
    .order("started_at", { ascending: false })
    .limit(5);
  console.log(`\n-- ${o.name} (${o.id}) --`);
  for (const c of data ?? [])
    console.log(`   ext=${c.external_id} phone=${c.client_phone} from=${c.from_number} to=${c.to_number} at=${c.started_at}`);
}

// Cross-org external_id collision check (same external_id under >1 org).
console.log("\n=== external_id reused across orgs? ===");
const seen = new Map();
let dup = 0;
for (const o of orgs ?? []) {
  let from = 0;
  for (;;) {
    const { data } = await sb
      .from("calls")
      .select("external_id")
      .eq("organization_id", o.id)
      .eq("source", "sipuni")
      .range(from, from + 999);
    for (const r of data ?? []) {
      const k = r.external_id ?? "<null>";
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(o.id);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}
for (const [k, set] of seen) if (set.size > 1) { dup++; if (dup <= 10) console.log(`   external_id=${k} in ${set.size} orgs`); }
console.log(`   total external_ids shared across orgs: ${dup}`);

process.exit(0);

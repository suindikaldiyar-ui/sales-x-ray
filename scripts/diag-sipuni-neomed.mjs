import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

const { data: orgs } = await sb.from("organizations").select("id, name");
const neomed = (orgs ?? []).find((o) => /neomed/i.test(o.name));
if (!neomed) { console.log("neomed org not found"); process.exit(1); }

const { data: integ } = await sb
  .from("integrations")
  .select("config")
  .eq("organization_id", neomed.id)
  .eq("provider", "sipuni")
  .maybeSingle();

const cfg = integ?.config ?? {};
console.log(`Neomed sipuni config: user_id=${cfg.user_id ?? "—"} api_key.len=${cfg.api_key ? String(cfg.api_key).length : 0} tail=${cfg.api_key ? String(cfg.api_key).slice(-4) : "—"}`);
if (!cfg.user_id || !cfg.api_key) { console.log("no creds stored"); process.exit(1); }

const API_URL = "https://sipuni.com/api";
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
function authedUrl(path, pairs) {
  const hash = md5(pairs.map(([, v]) => String(v).toLowerCase()).join("+"));
  const qs = new URLSearchParams();
  for (const [k, v] of pairs) { if (k === "secret") continue; qs.set(k, String(v)); }
  qs.set("hash", hash);
  return `${API_URL}${path}?${qs.toString()}`;
}
function ddmmyyyy(d) {
  const p = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}.${g("year")}`;
}

const to = new Date();
const from = new Date(to.getTime() - 2 * 86400000);

async function call(label, path, pairs) {
  const url = authedUrl(path, pairs);
  const safe = url.replace(/hash=[^&]+/, "hash=***");
  let res;
  try { res = await fetch(url, { method: "POST", cache: "no-store" }); }
  catch (e) { console.log(`\n[${label}] NETWORK ERROR`, e.message); return; }
  const ct = res.headers.get("content-type") || "";
  const body = await res.text().catch(() => "");
  console.log(`\n[${label}] ${safe}`);
  console.log(`  -> status=${res.status} content-type=${ct} len=${body.length}`);
  console.log(`  body[0..200]= ${JSON.stringify(body.slice(0, 200))}`);
}

// 1) operators (ping) — lightweight
await call("operators", "/statistic/operators", [
  ["user", cfg.user_id],
  ["secret", cfg.api_key],
]);

// 2) export — the call that 500'd
await call("export", "/statistic/export", [
  ["anonymous", "1"],
  ["firstTime", "0"],
  ["from", ddmmyyyy(from)],
  ["fromNumber", ""],
  ["state", "0"],
  ["to", ddmmyyyy(to)],
  ["toAnswer", ""],
  ["toNumber", "0"],
  ["tree", ""],
  ["type", "0"],
  ["user", cfg.user_id],
  ["secret", cfg.api_key],
]);

process.exit(0);

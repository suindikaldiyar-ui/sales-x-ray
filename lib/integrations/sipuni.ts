import "server-only";
import { createHash } from "crypto";
import type { IntegrationConnector, ConnectionCheck, SyncResult } from "./types";
import { NotImplementedYet } from "./types";

export interface SipuniConfig {
  user_id: string;
  api_key: string;
}

// Sipuni API — base + auth per the official client:
//   https://github.com/bzdvdn/sipuni-api-wrapper  ·  user + secret(api key)
//   hash = md5 of all param VALUES (lowercased, joined by "+"); the secret is
//   replaced by `hash` in the query string.
const API_URL = "https://sipuni.com/api";

function md5(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

/** Build the authed URL. `pairs` MUST include the ['secret', token] pair in the
 * exact position Sipuni expects — the hash is computed over the values in order. */
function authedUrl(path: string, pairs: [string, string][]): string {
  const hash = md5(pairs.map(([, v]) => String(v).toLowerCase()).join("+"));
  const qs = new URLSearchParams();
  for (const [k, v] of pairs) {
    if (k === "secret") continue;
    qs.set(k, String(v));
  }
  qs.set("hash", hash);
  return `${API_URL}${path}?${qs.toString()}`;
}

function ddmmyyyy(d: Date): string {
  // Sipuni expects DD.MM.YYYY in the account timezone (Almaty).
  const p = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

export interface SipuniCall {
  externalId: string;
  direction: "in" | "out" | null;
  clientPhone: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  managerName: string | null;
  managerExternalId: string | null;
  durationSec: number;
  status: string | null;
  answered: boolean;
  recordId: string | null;
  startedAt: string | null; // ISO
  raw: Record<string, string>;
}

/** Live Sipuni client. API key + user id are per-organization (server-only). */
export class SipuniApiClient {
  constructor(
    private readonly user: string,
    private readonly secret: string,
  ) {}

  private async post(path: string, pairs: [string, string][]): Promise<string> {
    const url = authedUrl(path, pairs);
    const safe = url.replace(/hash=[^&]+/, "hash=***");
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", cache: "no-store" });
    } catch (e) {
      console.error(`[sipuni] POST ${safe} -> network error`, e);
      throw new Error("Не удалось связаться с Sipuni (сеть).");
    }
    const body = await res.text().catch(() => "");
    console.log(`[sipuni] POST ${safe} -> ${res.status} ${body.slice(0, 600)}`);
    if (res.status === 401 || res.status === 403) {
      throw new Error("Sipuni 401/403: неверный API-ключ или user ID.");
    }
    if (res.status > 204) {
      throw new Error(`Sipuni ${res.status}: ${body.slice(0, 200)}`);
    }
    return body;
  }

  /** Managers list (CSV) — also used as a lightweight connectivity check. */
  async getManagers(): Promise<string> {
    return this.post("/statistic/operators", [
      ["user", this.user],
      ["secret", this.secret],
    ]);
  }

  async ping(): Promise<void> {
    const body = await this.getManagers();
    // Wrong credentials usually come back as a short non-CSV error string.
    if (/неверн|invalid|error|wrong|hash/i.test(body) && !body.includes(";")) {
      throw new Error(`Sipuni отклонил ключ: ${body.slice(0, 160)}`);
    }
  }

  /** Call statistics CSV for [from, to]. */
  async getCallStatsCsv(fromDate: Date, toDate: Date): Promise<string> {
    return this.post("/statistic/export", [
      ["anonymous", "1"],
      ["firstTime", "0"],
      ["from", ddmmyyyy(fromDate)],
      ["fromNumber", ""],
      ["state", "0"],
      ["to", ddmmyyyy(toDate)],
      ["toAnswer", ""],
      ["toNumber", "0"],
      ["tree", ""],
      ["type", "0"],
      ["user", this.user],
      ["secret", this.secret],
    ]);
  }

  async getCalls(fromDate: Date, toDate: Date): Promise<SipuniCall[]> {
    const csv = await this.getCallStatsCsv(fromDate, toDate);
    return parseCallsCsv(csv);
  }
}

export function createSipuniClient(config: SipuniConfig): SipuniApiClient {
  return new SipuniApiClient(config.user_id, config.api_key);
}

// ── CSV parsing ─────────────────────────────────────────────────────────────
// Sipuni's export is a ';'-separated CSV with a Russian header row. We map by
// header name (defensively, with fallbacks) and keep the full row in `raw` so
// the field mapping can be refined against a real response.

function splitCsvLine(line: string): string[] {
  // Simple split — Sipuni fields are not quoted in practice.
  return line.split(";").map((c) => c.trim().replace(/^"|"$/g, ""));
}

function parseDuration(v: string): number {
  if (!v) return 0;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s); // seconds
  const parts = s.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(s) || 0;
}

function parseSipuniDate(v: string): string | null {
  // "DD.MM.YYYY HH:MM:SS" in Almaty time → UTC ISO.
  const m = v?.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const utcMs =
    Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +(ss ?? "0")) - 5 * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

export function parseCallsCsv(csv: string): SipuniCall[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (...needles: string[]) =>
    header.findIndex((h) => needles.some((n) => h.includes(n)));

  const iType = find("тип");
  const iStatus = find("статус");
  const iTime = header.findIndex((h) => h === "время") >= 0
    ? header.findIndex((h) => h === "время")
    : find("время");
  const iFrom = find("откуда", "from");
  const iTo = find("куда", "to");
  const iManager = find("кто ответил", "ответил", "сотрудник", "менеджер", "оператор");
  const iTalk = find("длительность разговора", "разговор");
  const iDur = find("длительность звонка", "длительность");
  const iRecord = find("запись", "record");
  const iId = header.findIndex((h) => h === "id" || h.includes("id звонка") || h.includes("идентификатор"));

  const at = (cols: string[], i: number) => (i >= 0 && i < cols.length ? cols[i] : "");

  const out: SipuniCall[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    if (cols.length < 2) continue;

    const typeRaw = at(cols, iType).toLowerCase();
    const direction: "in" | "out" | null = typeRaw.includes("вход")
      ? "in"
      : typeRaw.includes("исход")
        ? "out"
        : null;
    const statusRaw = at(cols, iStatus);
    const answered = /отвеч|дозвон|успеш|принят|talk|answered/i.test(statusRaw);
    const fromNumber = at(cols, iFrom) || null;
    const toNumber = at(cols, iTo) || null;
    const clientPhone = direction === "out" ? toNumber : fromNumber;
    const durationSec = parseDuration(at(cols, iTalk) || at(cols, iDur));
    const startedAt = parseSipuniDate(at(cols, iTime));
    const recordId = at(cols, iRecord) || null;
    const externalId =
      at(cols, iId) ||
      md5(`${at(cols, iTime)}|${fromNumber ?? ""}|${toNumber ?? ""}|${at(cols, iManager)}`);

    const raw: Record<string, string> = {};
    header.forEach((h, i) => (raw[h] = at(cols, i)));

    out.push({
      externalId,
      direction,
      clientPhone,
      fromNumber,
      toNumber,
      managerName: at(cols, iManager) || null,
      managerExternalId: at(cols, iManager) || null,
      durationSec,
      status: statusRaw || null,
      answered,
      recordId: recordId && recordId !== "0" ? recordId : null,
      startedAt,
      raw,
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
//  Connector (catalog/validation + real testConnection)
// ════════════════════════════════════════════════════════════════════════
export const sipuni: IntegrationConnector<SipuniConfig> = {
  provider: "sipuni",
  label: "Sipuni",
  configFields: [
    { key: "user_id", label: "ID пользователя", placeholder: "Например: 100500", type: "text", required: true },
    {
      key: "api_key",
      label: "API-ключ",
      placeholder: "Ключ интеграции Sipuni",
      type: "password",
      required: true,
      help: "Профиль → Интеграция → API в кабинете Sipuni.",
    },
  ],
  validateConfig(config): boolean {
    return (
      typeof config.user_id === "string" &&
      config.user_id.length > 0 &&
      typeof config.api_key === "string" &&
      config.api_key.length > 0
    );
  },
  async testConnection(config): Promise<ConnectionCheck> {
    try {
      await createSipuniClient(config).ping();
      return { connected: true, message: "Соединение с Sipuni установлено." };
    } catch (err) {
      return {
        connected: false,
        message: err instanceof Error ? err.message : "Не удалось подключиться.",
      };
    }
  },
  async sync(): Promise<SyncResult> {
    // Real sync lives in lib/integrations/sipuni-sync.ts (needs the DB client).
    throw new NotImplementedYet("sipuni");
  },
};

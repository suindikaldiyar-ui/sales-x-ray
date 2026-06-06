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

interface ColIdx {
  type: number;
  status: number;
  time: number;
  from: number;
  to: number;
  manager: number;
  talk: number;
  dur: number;
  record: number;
  id: number;
}

// Positional layout of the Sipuni export (no header), per the real sample:
//   Входящий;Отвечен;06.06.2026 13:50:45;Входящая;+7701…;+7700…;205;15;9;6;…
//   0 тип   1 статус 2 время            3 схема   4 откуда 5 куда 6 менеджер
//   7 время дозвона  8 длительность разговора  9 оценка …
const POSITIONAL: ColIdx = {
  type: 0, status: 1, time: 2, from: 4, to: 5, manager: 6, talk: 8, dur: 7, record: -1, id: -1,
};

function looksLikeHeader(firstLower: string[]): boolean {
  return firstLower.some((c) =>
    /^(тип|статус|время|схема|откуда|куда|длительност|кто ответил|оператор|запис|id)/.test(c),
  );
}

function isMissed(statusLower: string): boolean {
  return /пропущ|не\s*отвеч|не\s*дозвон|недозвон|не\s*приня|неприня|занят|busy|missed|нет ответа|без ответа|отмен|сброс|fail|неуспеш/.test(
    statusLower,
  );
}

export function parseCallsCsv(csv: string): SipuniCall[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const firstCols = splitCsvLine(lines[0]);
  const firstLower = firstCols.map((c) => c.toLowerCase());
  const hasHeader = looksLikeHeader(firstLower);

  let idx: ColIdx;
  if (hasHeader) {
    const find = (...needles: string[]) =>
      firstLower.findIndex((h) => needles.some((n) => h.includes(n)));
    const exact = (name: string) => firstLower.findIndex((h) => h === name);
    idx = {
      type: find("тип"),
      status: find("статус"),
      time: exact("время") >= 0 ? exact("время") : find("время"),
      from: find("откуда", "from"),
      to: find("куда", "to"),
      manager: find("кто ответил", "ответил", "оператор", "сотрудник", "менеджер", "внутренний"),
      talk: find("длительность разговора", "разговор"),
      dur: find("длительность звонка", "дозвон", "длительность"),
      record: find("запись", "record"),
      id: exact("id") >= 0 ? exact("id") : find("идентификатор"),
    };
  } else {
    idx = POSITIONAL;
  }

  const dataStart = hasHeader ? 1 : 0;
  const headerNames = hasHeader ? firstLower : [];

  // Log header + first data row so the column mapping can be verified.
  console.log(`[sipuni] csv header(${hasHeader ? "yes" : "no"}): ${lines[0]?.slice(0, 400)}`);
  if (lines[dataStart]) console.log(`[sipuni] csv row0: ${lines[dataStart].slice(0, 400)}`);
  console.log(`[sipuni] csv idx=${JSON.stringify(idx)}`);

  const at = (cols: string[], i: number) => (i >= 0 && i < cols.length ? cols[i].trim() : "");

  const out: SipuniCall[] = [];
  for (let r = dataStart; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    if (cols.length < 3) continue;

    const typeRaw = at(cols, idx.type).toLowerCase();
    const direction: "in" | "out" | null = typeRaw.includes("вход")
      ? "in"
      : typeRaw.includes("исход")
        ? "out"
        : null;

    const statusRaw = at(cols, idx.status);
    const sl = statusRaw.toLowerCase();
    const talkSec = parseDuration(at(cols, idx.talk) || at(cols, idx.dur));
    const missed = isMissed(sl);
    const answered = missed
      ? false
      : /отвеч|дозвон|успеш|приня|answered|talk|разговор/.test(sl) || talkSec > 0;

    const fromNumber = at(cols, idx.from) || null;
    const toNumber = at(cols, idx.to) || null;
    const clientPhone = direction === "out" ? toNumber : fromNumber;
    const startedAt = parseSipuniDate(at(cols, idx.time));
    const manager = at(cols, idx.manager) || null;
    const recordId = at(cols, idx.record) || null;
    const externalId =
      at(cols, idx.id) ||
      md5(`${at(cols, idx.time)}|${fromNumber ?? ""}|${toNumber ?? ""}|${manager ?? ""}|${typeRaw}|${talkSec}`);

    const raw: Record<string, string> = {};
    if (hasHeader) headerNames.forEach((h, i) => (raw[h] = at(cols, i)));
    else cols.forEach((v, i) => (raw[`col${i}`] = v));

    out.push({
      externalId,
      direction,
      clientPhone,
      fromNumber,
      toNumber,
      managerName: manager,
      managerExternalId: manager,
      durationSec: talkSec,
      status: statusRaw || null,
      answered,
      recordId: recordId && recordId !== "0" ? recordId : null,
      startedAt,
      raw,
    });
  }
  console.log(
    `[sipuni] parsed ${out.length} calls (answered=${out.filter((c) => c.answered).length}, missed=${out.filter((c) => !c.answered).length})`,
  );
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

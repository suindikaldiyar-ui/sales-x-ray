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
  hasRecord: boolean;
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
    const ct = res.headers.get("content-type") || "";
    const body = await res.text().catch(() => "");
    // Diagnostic: status + content-type + a short, single-line, secret-free
    // slice of the body. This is what reveals WHY Sipuni rejected the request
    // (e.g. an HTML error page saying "Неправильный хеш").
    console.log(
      `[sipuni] POST ${safe} -> ${res.status} ct=${ct} ${body.slice(0, 200).replace(/\s+/g, " ").trim()}`,
    );

    if (res.status === 401 || res.status === 403) {
      throw new Error("Sipuni отклонил доступ (401/403): проверьте user_id и API-ключ Sipuni.");
    }

    // Sipuni signals a bad signature with an HTML error page (usually HTTP 500)
    // that contains "Неправильный хеш". Detect it by body shape, NOT by
    // content-type, so a valid CSV is never mis-flagged.
    const looksHtml = /^\s*<(?:!doctype|html)/i.test(body);
    if (/неправильн\w*\s*хеш/i.test(body)) {
      throw new Error(
        "Sipuni отклонил подпись запроса («Неправильный хеш»). Проверьте user_id и API-ключ " +
          "Sipuni — ключ должен быть скопирован полностью, без пробелов и обрезаний.",
      );
    }
    if (res.status > 204 || looksHtml) {
      throw new Error(
        `Sipuni вернул ошибку (код ${res.status}). Проверьте правильность ключей Sipuni ` +
          "(user_id, API-ключ) и доступ к API в кабинете Sipuni.",
      );
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

  /** Download a call recording (binary). Auth = same md5-hash as export. */
  async getRecordById(recordId: string): Promise<{ data: ArrayBuffer; contentType: string }> {
    const url = authedUrl("/statistic/record", [
      ["id", recordId],
      ["user", this.user],
      ["secret", this.secret],
    ]);
    const safe = url.replace(/hash=[^&]+/, "hash=***");
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", cache: "no-store" });
    } catch (e) {
      console.error(`[sipuni record] POST ${safe} -> network error`, e);
      throw new Error("Не удалось связаться с Sipuni (сеть).");
    }
    const ct = res.headers.get("content-type") || "";
    if (res.status === 401 || res.status === 403) {
      console.error(`[sipuni record] POST ${safe} -> ${res.status}`);
      throw new Error("Sipuni 401/403: неверный API-ключ или нет доступа к записи.");
    }
    if (res.status > 204) {
      const body = await res.text().catch(() => "");
      console.error(`[sipuni record] POST ${safe} -> ${res.status} ${body.slice(0, 300)}`);
      throw new Error(`Sipuni ${res.status}: запись недоступна.`);
    }
    const data = await res.arrayBuffer();
    console.log(`[sipuni record] POST ${safe} -> ${res.status} ct=${ct} bytes=${data.byteLength}`);
    // If Sipuni returned a JSON/text error with 200, it's not audio.
    if (!ct.includes("audio") && !ct.includes("octet-stream") && data.byteLength < 200) {
      const txt = Buffer.from(data).toString("utf8").slice(0, 200);
      throw new Error(`Sipuni не вернул аудио: ${txt}`);
    }
    return { data, contentType: ct.includes("audio") ? ct : "audio/mpeg" };
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
  managerCrm: number;
  talk: number;
  dur: number;
  record: number;
  hasRecord: number;
  id: number;
}

// Full Sipuni export layout (header is fixed):
//   0 Тип 1 Статус 2 Время 3 Схема 4 Откуда 5 Куда 6 Кто ответил
//   7 Длит.звонка 8 Длит.разговора 9 Время ответа 10 Оценка 11 ID записи
//   12 Метка 13 Теги 14 ID заказа звонка 15 Запись существует 16 Новый клиент
//   17 Состояние перезвона 18 Время перезвона 19 Информация из CRM
//   20 Ответственный из CRM
const POSITIONAL: ColIdx = {
  type: 0, status: 1, time: 2, from: 4, to: 5, manager: 6, managerCrm: 20,
  talk: 8, dur: 7, record: 11, hasRecord: 15, id: 14,
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
    // Exact-name first (avoids traps like "откуда".includes("куда")), then a
    // safe substring fallback, else the known positional index.
    const exact = (name: string) => firstLower.findIndex((h) => h === name);
    const has = (needle: string) => firstLower.findIndex((h) => h.includes(needle));
    const pick = (fallback: number, exactName: string, contains?: string) => {
      const e = exact(exactName);
      if (e >= 0) return e;
      if (contains) {
        const c = has(contains);
        if (c >= 0) return c;
      }
      return fallback;
    };
    idx = {
      type: pick(0, "тип"),
      status: pick(1, "статус"),
      time: pick(2, "время"),
      from: pick(4, "откуда"),
      to: pick(5, "куда"),
      manager: pick(6, "кто ответил", "кто ответил"),
      managerCrm: pick(20, "ответственный из crm", "ответственный"),
      talk: pick(8, "длительность разговора, сек", "длительность разговора"),
      dur: pick(7, "длительность звонка, сек", "длительность звонка"),
      record: pick(11, "id записи", "id записи"),
      hasRecord: pick(15, "запись существует", "запись существует"),
      id: pick(14, "id заказа звонка", "id заказа"),
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
  const statusValues = new Set<string>();
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
    if (statusRaw) statusValues.add(statusRaw);
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

    // Manager: "Кто ответил" → else "Ответственный из CRM" → else null.
    const answeredBy = at(cols, idx.manager);
    const crmResponsible = at(cols, idx.managerCrm);
    const manager = answeredBy || crmResponsible || null;

    const recordIdRaw = at(cols, idx.record);
    const recordId = recordIdRaw && recordIdRaw !== "0" ? recordIdRaw : null;
    const hasRecordRaw = at(cols, idx.hasRecord).toLowerCase();
    const hasRecord = /^(1|да|true|yes|есть)$/.test(hasRecordRaw) || Boolean(recordId);

    const orderId = at(cols, idx.id);
    const externalId =
      orderId ||
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
      recordId,
      hasRecord,
      startedAt,
      raw,
    });
  }
  console.log(
    `[sipuni] parsed ${out.length} calls (answered=${out.filter((c) => c.answered).length}, ` +
      `missed=${out.filter((c) => !c.answered).length})`,
  );
  console.log(`[sipuni] уникальные статусы: ${[...statusValues].join(" | ")}`);
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

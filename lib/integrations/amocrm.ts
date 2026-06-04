import "server-only";
import type { IntegrationConnector, ConnectionCheck, SyncResult } from "./types";
import { NotImplementedYet } from "./types";

export interface AmoCrmConfig {
  base_url: string; // e.g. https://mycompany.amocrm.ru
  access_token: string; // long-lived token
}

// ── amoCRM reserved status ids ────────────────────────────────────────────
const WON_STATUS_ID = 142; // "successfully realized"
const LOST_STATUS_ID = 143; // "closed and unrealized"

// ── pagination / throughput tuning (high-volume accounts) ─────────────────
const PAGE_SIZE = 250; // amoCRM hard max per leads page
const EVENT_PAGE_SIZE = 100; // amoCRM hard max per events page
const PAGE_CONCURRENCY = 6; // pages in flight; pacing handled by the gate
const MAX_LEAD_PAGES = 200; // safety stop ≈ 50k leads
const MAX_EVENT_PAGES = 1200; // safety stop ≈ 120k status-change events

// ── short-lived raw-response cache (per server process) ───────────────────
const RESPONSE_TTL_MS = 120_000;
const responseCache = new Map<string, { at: number; data: unknown }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Quantize a unix-seconds timestamp down to a 10-minute bucket so that the
 * date boundary of a sync window is stable across calls — this lets the
 * in-process response cache actually hit on repeated syncs.
 */
export function quantizeTo10Min(unixSeconds: number): number {
  const bucket = 600;
  return Math.floor(unixSeconds / bucket) * bucket;
}

// ── global request pacer ──────────────────────────────────────────────────
// amoCRM caps at ~7 req/s. Concurrency alone bursts past that, so we space out
// request *starts* by a fixed interval (~5.9 req/s) while still letting slow
// responses overlap. Shared across all callers in the process.
const MIN_REQUEST_INTERVAL_MS = 170;
let nextRequestSlot = 0;
async function rateLimitGate(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextRequestSlot - now);
  nextRequestSlot = Math.max(now, nextRequestSlot) + MIN_REQUEST_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

// ── raw amoCRM shapes ─────────────────────────────────────────────────────
interface AmoStatusRaw {
  id: number;
  name: string;
  sort: number;
  type: number;
  color?: string;
}
interface AmoPipelineRaw {
  id: number;
  name: string;
  is_main?: boolean;
  sort?: number;
  _embedded?: { statuses?: AmoStatusRaw[] };
}
interface AmoLeadRaw {
  id: number;
  name: string | null;
  price: number | null;
  status_id: number;
  pipeline_id: number;
  responsible_user_id?: number;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  _embedded?: { loss_reason?: { id: number; name: string }[] };
}
interface AmoEventRaw {
  type: string;
  entity_id: number;
  created_at: number;
  value_before?: { lead_status?: { id: number; pipeline_id: number } }[];
  value_after?: { lead_status?: { id: number; pipeline_id: number } }[];
}
interface AmoUserRaw {
  id: number;
  name: string;
  email?: string;
}

// ── normalized shapes returned to the sync layer ──────────────────────────
export interface AmoStage {
  id: number;
  pipelineId: number;
  name: string;
  sort: number;
  isWon: boolean;
  isLost: boolean;
  color?: string;
}
export interface AmoPipeline {
  id: number;
  name: string;
  isMain: boolean;
  sort: number;
  stages: AmoStage[];
}
export interface AmoUser {
  id: number;
  name: string;
  email: string | null;
}
export interface AmoLead {
  id: number;
  name: string;
  pipelineId: number;
  statusId: number;
  price: number;
  responsibleUserId: number | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  isWon: boolean;
  isLost: boolean;
  lossReason: string | null;
}
/** A single status a lead was observed to occupy, per its history. */
export interface StageHit {
  leadId: number;
  statusId: number;
  at: number;
}

export interface GetLeadsParams {
  pipelineId: number;
  dateFrom?: number; // unix seconds, lower bound on created_at
}

/**
 * Live amoCRM REST API v4 client. Bearer token + base URL are passed in per
 * organization (read from the `integrations` table on the server). Paces and
 * retries every request under a shared rate limiter; memoizes raw responses
 * for a short TTL. Server-only.
 */
export class AmoApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;

    const cached = responseCache.get(url);
    if (cached && Date.now() - cached.at < RESPONSE_TTL_MS) {
      return cached.data as T;
    }

    // Few attempts with a CAPPED backoff so a single request can never tie up a
    // batch for long. If it still fails, we throw — the caller persists its
    // cursor and the client safely retries the whole (idempotent) batch.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await rateLimitGate();
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const raw =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 500 * Math.pow(2, attempt); // 0.5s, 1s, 2s
        const backoff = Math.min(raw, 4000); // hard cap so we never sleep long
        // Cool down the whole pacer, not just this retry.
        nextRequestSlot = Math.max(nextRequestSlot, Date.now() + backoff);
        await sleep(backoff);
        lastErr = new Error("amoCRM 429 (rate limited)");
        continue;
      }
      if (res.status === 204) {
        const empty = {} as T;
        responseCache.set(url, { at: Date.now(), data: empty });
        return empty;
      }
      if (res.status === 401) {
        throw new Error(
          "amoCRM 401: токен недействителен или истёк. Обновите токен на странице «Интеграции».",
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`amoCRM ${res.status} on ${path}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as T;
      responseCache.set(url, { at: Date.now(), data });
      return data;
    }
    throw lastErr instanceof Error ? lastErr : new Error("amoCRM request failed");
  }

  /** Lightweight connectivity check (also confirms the token works). */
  async ping(): Promise<void> {
    await this.request("/api/v4/leads/pipelines");
  }

  async getPipelines(): Promise<AmoPipeline[]> {
    const data = await this.request<{
      _embedded?: { pipelines?: AmoPipelineRaw[] };
    }>("/api/v4/leads/pipelines");
    const pipelines = data._embedded?.pipelines ?? [];
    return pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      isMain: Boolean(p.is_main),
      sort: p.sort ?? 0,
      stages: (p._embedded?.statuses ?? [])
        .map<AmoStage>((s) => ({
          id: s.id,
          pipelineId: p.id,
          name: s.name,
          sort: s.sort,
          isWon: s.id === WON_STATUS_ID || s.type === 1,
          isLost: s.id === LOST_STATUS_ID,
          color: s.color,
        }))
        .sort((a, b) => a.sort - b.sort),
    }));
  }

  /** Full amoCRM user directory (managers), paged. */
  async getUsers(): Promise<AmoUser[]> {
    const out: AmoUser[] = [];
    let page = 1;
    while (page <= 50) {
      const data = await this.request<{ _embedded?: { users?: AmoUserRaw[] } }>(
        `/api/v4/users?page=${page}&limit=250`,
      );
      const users = data._embedded?.users ?? [];
      for (const u of users) out.push({ id: u.id, name: u.name, email: u.email ?? null });
      if (users.length < 250) break;
      page += 1;
    }
    return out;
  }

  private leadsPageUrl(params: GetLeadsParams, page: number): string {
    const qs = new URLSearchParams();
    qs.set("limit", String(PAGE_SIZE));
    qs.set("page", String(page));
    qs.set("with", "loss_reason");
    qs.set("filter[pipeline_id]", String(params.pipelineId));
    if (params.dateFrom) qs.set("filter[created_at][from]", String(params.dateFrom));
    return `/api/v4/leads?${qs.toString()}`;
  }

  private async fetchLeadsPage(
    params: GetLeadsParams,
    page: number,
  ): Promise<AmoLeadRaw[]> {
    const data = await this.request<{ _embedded?: { leads?: AmoLeadRaw[] } }>(
      this.leadsPageUrl(params, page),
    );
    return data._embedded?.leads ?? [];
  }

  /**
   * A single page of normalized leads. `isLast` is true when the page came back
   * short (the final page). Used by the incremental/batched sync.
   */
  async getLeadsPage(
    params: GetLeadsParams,
    page: number,
  ): Promise<{ leads: AmoLead[]; isLast: boolean }> {
    const raw = await this.fetchLeadsPage(params, page);
    return { leads: raw.map((l) => this.normalizeLead(l)), isLast: raw.length < PAGE_SIZE };
  }

  /** All leads of a pipeline created since `dateFrom`, paged in parallel waves. */
  async getLeads(params: GetLeadsParams): Promise<AmoLead[]> {
    const out: AmoLead[] = [];
    let page = 1;
    let reachedEnd = false;

    while (!reachedEnd && page <= MAX_LEAD_PAGES) {
      const wave: Promise<AmoLeadRaw[]>[] = [];
      for (let i = 0; i < PAGE_CONCURRENCY && page + i <= MAX_LEAD_PAGES; i++) {
        wave.push(this.fetchLeadsPage(params, page + i));
      }
      page += wave.length;

      const pages = await Promise.all(wave);
      for (const leads of pages) {
        for (const l of leads) out.push(this.normalizeLead(l));
        if (leads.length < PAGE_SIZE) reachedEnd = true;
      }
    }
    return out;
  }

  private normalizeLead(l: AmoLeadRaw): AmoLead {
    return {
      id: l.id,
      name: l.name ?? `Сделка #${l.id}`,
      pipelineId: l.pipeline_id,
      statusId: l.status_id,
      price: l.price ?? 0,
      responsibleUserId: l.responsible_user_id ?? null,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
      closedAt: l.closed_at,
      isWon: l.status_id === WON_STATUS_ID,
      isLost: l.status_id === LOST_STATUS_ID,
      lossReason: l._embedded?.loss_reason?.[0]?.name ?? null,
    };
  }

  private eventsPageUrl(dateFrom: number | undefined, page: number): string {
    const qs = new URLSearchParams();
    qs.append("filter[type][]", "lead_status_changed");
    qs.append("filter[entity][]", "lead");
    if (dateFrom) qs.set("filter[created_at][from]", String(dateFrom));
    qs.set("limit", String(EVENT_PAGE_SIZE));
    qs.set("page", String(page));
    return `/api/v4/events?${qs.toString()}`;
  }

  private async fetchEventsPage(
    dateFrom: number | undefined,
    page: number,
  ): Promise<AmoEventRaw[]> {
    const data = await this.request<{ _embedded?: { events?: AmoEventRaw[] } }>(
      this.eventsPageUrl(dateFrom, page),
    );
    return data._embedded?.events ?? [];
  }

  /**
   * Every status a lead was observed to occupy since `dateFrom`, as
   * (leadId, statusId) endpoints of each move. Lets the sync layer reconstruct
   * the FURTHEST stage each lead ever reached — so dumped ("lost") deals don't
   * collapse onto the first stage. amoCRM caps the entity_id filter at 10, so
   * we scan by date, paged in parallel waves under the shared limiter.
   */
  /**
   * A single page of status-change history as (leadId, statusId) hits. `isLast`
   * marks the final page. Used by the incremental/batched sync.
   */
  async getStageHitsPage(
    dateFrom: number | undefined,
    page: number,
  ): Promise<{ hits: StageHit[]; isLast: boolean }> {
    const events = await this.fetchEventsPage(dateFrom, page);
    const hits: StageHit[] = [];
    for (const e of events) {
      const before = e.value_before?.[0]?.lead_status?.id;
      const after = e.value_after?.[0]?.lead_status?.id;
      if (before != null) hits.push({ leadId: e.entity_id, statusId: before, at: e.created_at });
      if (after != null) hits.push({ leadId: e.entity_id, statusId: after, at: e.created_at });
    }
    return { hits, isLast: events.length < EVENT_PAGE_SIZE };
  }

  async getStageHitsSince(dateFrom: number | undefined): Promise<StageHit[]> {
    const hits: StageHit[] = [];
    let page = 1;
    let reachedEnd = false;

    while (!reachedEnd && page <= MAX_EVENT_PAGES) {
      const wave: Promise<AmoEventRaw[]>[] = [];
      for (let i = 0; i < PAGE_CONCURRENCY && page + i <= MAX_EVENT_PAGES; i++) {
        wave.push(this.fetchEventsPage(dateFrom, page + i));
      }
      page += wave.length;

      const pages = await Promise.all(wave);
      for (const events of pages) {
        for (const e of events) {
          const before = e.value_before?.[0]?.lead_status?.id;
          const after = e.value_after?.[0]?.lead_status?.id;
          if (before != null) hits.push({ leadId: e.entity_id, statusId: before, at: e.created_at });
          if (after != null) hits.push({ leadId: e.entity_id, statusId: after, at: e.created_at });
        }
        if (events.length < EVENT_PAGE_SIZE) reachedEnd = true;
      }
    }
    return hits;
  }
}

/** Factory used by the sync layer. */
export function createAmoApiClient(config: AmoCrmConfig): AmoApiClient {
  return new AmoApiClient(config.base_url, config.access_token);
}

// ════════════════════════════════════════════════════════════════════════
//  Connector (catalog/validation surface for the registry & Integrations UI)
// ════════════════════════════════════════════════════════════════════════
export const amocrm: IntegrationConnector<AmoCrmConfig> = {
  provider: "amocrm",
  label: "amoCRM",
  configFields: [
    {
      key: "base_url",
      label: "Адрес аккаунта",
      placeholder: "https://mycompany.amocrm.ru",
      type: "url",
      required: true,
      help: "Домен вашего портала amoCRM.",
    },
    {
      key: "access_token",
      label: "Долгоживущий токен",
      placeholder: "eyJ0eXAiOiJKV1Qi…",
      type: "password",
      required: true,
      help: "Настройки → Интеграции → Ключи и доступы.",
    },
  ],
  validateConfig(config): boolean {
    return (
      typeof config.base_url === "string" &&
      config.base_url.length > 0 &&
      typeof config.access_token === "string" &&
      config.access_token.length > 0
    );
  },
  async testConnection(config): Promise<ConnectionCheck> {
    try {
      await createAmoApiClient(config).ping();
      return { connected: true, message: "Соединение с amoCRM установлено." };
    } catch (err) {
      return {
        connected: false,
        message: err instanceof Error ? err.message : "Не удалось подключиться.",
      };
    }
  },
  async sync(): Promise<SyncResult> {
    // Real sync is orchestrated in lib/integrations/amocrm-sync.ts (needs DB
    // access). The connector surface stays free of the Supabase client.
    throw new NotImplementedYet("amocrm");
  },
};

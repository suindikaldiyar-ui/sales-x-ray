import "server-only";
import type { IntegrationConnector, ConnectionCheck, SyncResult } from "./types";
import { NotImplementedYet } from "./types";

export interface WazzupConfig {
  api_key: string;
}

// Wazzup API v3 — base URL and auth per official docs:
//   https://wazzup24.com/help/api-en/  ·  Authorization: Bearer <api_key>
const BASE_URL = "https://api.wazzup24.com/v3";

// Conservative pacer + retries (Wazzup doesn't publish an exact rate limit).
const MIN_REQUEST_INTERVAL_MS = 220; // ≈4.5 req/s
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0;
async function gate() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_REQUEST_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

export interface WazzupChannel {
  channelId: string;
  transport: string | null; // whatsapp | telegram | instagram | …
  state: string | null;
  name: string | null;
  raw: Record<string, unknown>;
}
export interface WazzupUser {
  id: string;
  name: string;
  raw: Record<string, unknown>;
}

/** Pull an array out of either `[...]` or `{ data: [...] }` shaped responses. */
function asArray(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray((payload as any).data)) {
    return (payload as any).data;
  }
  return [];
}

/**
 * Live Wazzup API v3 client. The API key is passed per organization (read from
 * the `integrations` table on the server). Only the documented READ endpoints
 * are implemented — `GET /v3/channels` and `GET /v3/users`. Wazzup v3 has NO
 * REST endpoint for message history: incoming messages arrive only via
 * webhooks (see app/api/webhooks/wazzup). Server-only.
 */
export class WazzupApiClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await gate();
      const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoff = Math.min(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt,
          4000,
        );
        nextSlot = Math.max(nextSlot, Date.now() + backoff);
        await sleep(backoff);
        lastErr = new Error("Wazzup 429 (rate limited)");
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error("Wazzup 401/403: неверный или просроченный API-ключ.");
      }
      if (res.status === 204) return {} as T;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Wazzup ${res.status} on ${path}: ${body.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    }
    throw lastErr instanceof Error ? lastErr : new Error("Wazzup request failed");
  }

  /** GET /v3/channels — connected messenger channels. */
  async getChannels(): Promise<WazzupChannel[]> {
    const data = await this.request<unknown>("/channels");
    return asArray(data).map((c) => ({
      channelId: String(c.channelId ?? c.id ?? ""),
      transport: c.transport ?? c.type ?? null,
      state: c.state ?? null,
      name: c.name ?? c.plainId ?? null,
      raw: c,
    }));
  }

  /** GET /v3/users — active Wazzup users (managers), sorted by name. */
  async getUsers(): Promise<WazzupUser[]> {
    const data = await this.request<unknown>("/users");
    return asArray(data).map((u) => ({
      id: String(u.id ?? u.userId ?? ""),
      name: String(u.name ?? u.fullName ?? "—"),
      raw: u,
    }));
  }

  /** Lightweight connectivity + key validity check. */
  async ping(): Promise<void> {
    await this.request("/channels");
  }
}

export function createWazzupClient(config: WazzupConfig): WazzupApiClient {
  return new WazzupApiClient(config.api_key);
}

// ════════════════════════════════════════════════════════════════════════
//  Connector (catalog/validation surface for the registry & Integrations UI)
// ════════════════════════════════════════════════════════════════════════
export const wazzup: IntegrationConnector<WazzupConfig> = {
  provider: "wazzup",
  label: "Wazzup",
  configFields: [
    {
      key: "api_key",
      label: "API-ключ",
      placeholder: "Ключ из личного кабинета Wazzup",
      type: "password",
      required: true,
      help: "Личный кабинет Wazzup → Интеграции → API.",
    },
  ],
  validateConfig(config): boolean {
    return typeof config.api_key === "string" && config.api_key.length > 0;
  },
  async testConnection(config): Promise<ConnectionCheck> {
    try {
      await createWazzupClient(config).ping();
      return { connected: true, message: "Соединение с Wazzup установлено." };
    } catch (err) {
      return {
        connected: false,
        message: err instanceof Error ? err.message : "Не удалось подключиться.",
      };
    }
  },
  async sync(): Promise<SyncResult> {
    // Real sync (channels + users) lives in lib/integrations/wazzup-sync.ts,
    // which needs the Supabase client. Message history is not available over
    // REST — it is ingested via webhooks (next step after deploy).
    throw new NotImplementedYet("wazzup");
  },
};

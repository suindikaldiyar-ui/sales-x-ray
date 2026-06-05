import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createWazzupClient,
  type WazzupConfig,
  type WazzupChannel,
  type WazzupUser,
} from "./wazzup";

export class WazzupConfigError extends Error {}

export interface WazzupSyncSummary {
  channels: number;
  users: number;
  message: string;
}

/**
 * Sync the Wazzup directories we CAN read over REST: channels and users.
 * Message history is not available via the API — it is ingested via webhooks
 * (app/api/webhooks/wazzup), which is the post-deploy activation step. This
 * sync is small and idempotent (upsert), so it completes in a single call.
 * Writes go through the user's Supabase client → RLS-scoped to the org.
 */
export async function syncWazzup(
  supabase: SupabaseClient,
  org: string,
): Promise<WazzupSyncSummary> {
  const { data: integration, error: intErr } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", org)
    .eq("provider", "wazzup")
    .maybeSingle();
  if (intErr) throw new Error(intErr.message);

  const config = (integration?.config ?? {}) as Partial<WazzupConfig>;
  if (!config.api_key) {
    throw new WazzupConfigError(
      "Wazzup не подключён: сохраните API-ключ на странице «Интеграции».",
    );
  }

  const client = createWazzupClient(config as WazzupConfig);

  // Fetch the two directories INDEPENDENTLY. Some keys can read /v3/channels
  // but get 403 on /v3/users (no users-API access) — that must not fail the
  // whole sync. We save whatever succeeds and report the exact reason.
  let channels: WazzupChannel[] = [];
  let users: WazzupUser[] = [];
  let channelsErr: string | null = null;
  let usersErr: string | null = null;

  try {
    channels = await client.getChannels();
    console.log(`[sync wazzup] GET /v3/channels -> OK (${channels.length})`);
  } catch (e) {
    channelsErr = e instanceof Error ? e.message : String(e);
    console.error(`[sync wazzup] channels failed: ${channelsErr}`);
  }
  try {
    users = await client.getUsers();
    console.log(`[sync wazzup] GET /v3/users -> OK (${users.length})`);
  } catch (e) {
    usersErr = e instanceof Error ? e.message : String(e);
    console.error(`[sync wazzup] users failed: ${usersErr}`);
  }

  // Both endpoints failed → genuine problem; surface it.
  if (channelsErr && usersErr) {
    throw new Error(`${channelsErr}. ${usersErr}`);
  }

  if (channels.length > 0) {
    const { error } = await supabase.from("wazzup_channels").upsert(
      channels.map((c) => ({
        organization_id: org,
        channel_id: c.channelId,
        transport: c.transport,
        state: c.state,
        name: c.name,
        raw: c.raw,
      })),
      { onConflict: "organization_id,channel_id" },
    );
    if (error) throw new Error(`Сохранение каналов: ${error.message}`);
  }

  if (users.length > 0) {
    const { error } = await supabase.from("wazzup_users").upsert(
      users.map((u) => ({
        organization_id: org,
        external_id: u.id,
        name: u.name,
        raw: u.raw,
      })),
      { onConflict: "organization_id,external_id" },
    );
    if (error) throw new Error(`Сохранение менеджеров: ${error.message}`);
  }

  // At least one directory worked → the key is valid; mark connected.
  await supabase
    .from("integrations")
    .update({ status: "CONNECTED", last_synced_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("provider", "wazzup");

  console.log(
    `[sync wazzup] итог: каналов=${channels.length}, менеджеров=${users.length}` +
      (channelsErr ? ` | каналы: ${channelsErr}` : "") +
      (usersErr ? ` | менеджеры: ${usersErr}` : "") +
      " (сообщения — через вебхуки)",
  );
  for (const c of channels) {
    console.log(`[sync wazzup] канал ${c.transport ?? "?"} "${c.name ?? c.channelId}" (${c.state ?? "?"})`);
  }

  // Build a message that surfaces partial failures in the UI.
  const parts: string[] = [`каналов ${channels.length}`];
  parts.push(usersErr ? `менеджеры недоступны (${usersErr})` : `менеджеров ${users.length}`);
  if (channelsErr) parts.push(`каналы недоступны (${channelsErr})`);

  return {
    channels: channels.length,
    users: users.length,
    message: `${parts.join(", ")}. Переписка — через вебхуки (следующий шаг).`,
  };
}

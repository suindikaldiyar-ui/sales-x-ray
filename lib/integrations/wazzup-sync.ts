import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWazzupClient, type WazzupConfig } from "./wazzup";

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

  const [channels, users] = await Promise.all([client.getChannels(), client.getUsers()]);

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

  await supabase
    .from("integrations")
    .update({ status: "CONNECTED", last_synced_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("provider", "wazzup");

  // Diagnostics (messages come via webhooks, not REST).
  console.log(
    `[sync wazzup] каналов синхронизировано: ${channels.length}, ` +
      `менеджеров: ${users.length}, сообщений: 0 (история через вебхуки — следующий шаг)`,
  );
  for (const c of channels) {
    console.log(`[sync wazzup] канал ${c.transport ?? "?"} "${c.name ?? c.channelId}" (${c.state ?? "?"})`);
  }

  return {
    channels: channels.length,
    users: users.length,
    message: `Готово: каналов ${channels.length}, менеджеров ${users.length}. Переписка появится после подключения вебхуков.`,
  };
}

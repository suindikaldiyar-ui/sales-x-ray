import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAmoApiClient, type AmoCrmConfig, type AmoLead } from "./amocrm";
import { upsertContactPhones } from "./amocrm-phones";
import { syncOpenTasks } from "./amocrm-tasks";

// Incremental top-up tuning (cron runs are short — Hobby caps ~10s).
const MAX_PAGES_PER_PIPELINE = 4; // ≈1000 changed leads / pipeline / run
const MAX_CONTACT_PAGES = 6; // ≈1500 changed contacts / run (phone index)
const OVERLAP_SEC = 3600; // re-pull a 1h overlap to avoid gaps
const FALLBACK_DAYS = 2; // first-ever auto run window

export interface IncrementalResult {
  organizationId: string;
  leads: number;
  pipelines: number;
  skipped?: string;
}

const toISO = (sec: number | null | undefined): string | null =>
  sec ? new Date(sec * 1000).toISOString() : null;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Lightweight INCREMENTAL amoCRM sync for the cron job. Pulls only leads
 * changed since the last sync (filter[updated_at][from], with a small overlap)
 * and UPSERTS them — no delete/rebuild — so it stays fast and safe under the
 * cron time limit. Catalog (pipelines/stages/users) is upserted too. Read-only
 * w.r.t. amoCRM: it never changes stages or assignments there.
 *
 * Runs with the service-role admin client (cron has no user session), scoped
 * explicitly to `org` in every query.
 */
export async function runIncrementalSync(
  supabase: SupabaseClient,
  org: string,
  opts: { deadline?: number } = {},
): Promise<IncrementalResult> {
  const deadline = opts.deadline ?? Date.now() + 9000;

  const { data: integration } = await supabase
    .from("integrations")
    .select("config, last_synced_at, last_auto_synced_at")
    .eq("organization_id", org)
    .eq("provider", "amocrm")
    .maybeSingle();

  const config = (integration?.config ?? {}) as Partial<AmoCrmConfig>;
  if (!config.base_url || !config.access_token) {
    return { organizationId: org, leads: 0, pipelines: 0, skipped: "no config" };
  }

  const client = createAmoApiClient(config as AmoCrmConfig);
  const now = Math.floor(Date.now() / 1000);

  const lastIso =
    (integration?.last_synced_at as string | null) ??
    (integration?.last_auto_synced_at as string | null) ??
    null;
  const lastSec = lastIso ? Math.floor(new Date(lastIso).getTime() / 1000) : null;
  const updatedFrom = (lastSec ?? now - FALLBACK_DAYS * 86400) - OVERLAP_SEC;

  // ── catalog (upsert; dedupe system statuses 142/143 across pipelines) ────
  const pipelines = await client.getPipelines();
  const rankByStatus = new Map<number, number>();
  const openCountByPipeline = new Map<number, number>();
  const stageNameByStatus = new Map<number, string>();
  const pipelineName = new Map<number, string>();
  for (const p of pipelines) {
    pipelineName.set(p.id, p.name);
    const open = p.stages.filter((s) => !s.isWon && !s.isLost);
    openCountByPipeline.set(p.id, open.length);
    open.forEach((s, i) => rankByStatus.set(s.id, i + 1));
    for (const s of p.stages) stageNameByStatus.set(s.id, s.name);
  }

  await supabase.from("amocrm_pipelines").upsert(
    pipelines.map((p) => ({
      organization_id: org,
      external_id: p.id,
      name: p.name,
      is_main: p.isMain,
      sort: p.sort,
    })),
    { onConflict: "organization_id,external_id" },
  );
  const seenStage = new Set<number>();
  const stageRows = pipelines
    .flatMap((p) =>
      p.stages.map((s) => ({
        organization_id: org,
        pipeline_external_id: p.id,
        external_id: s.id,
        name: s.name,
        rank: s.isWon || s.isLost ? null : rankByStatus.get(s.id) ?? null,
        is_won: s.isWon,
        is_lost: s.isLost,
        color: s.color ?? null,
      })),
    )
    .filter((r) => (seenStage.has(r.external_id) ? false : (seenStage.add(r.external_id), true)));
  await supabase
    .from("amocrm_stages")
    .upsert(stageRows, { onConflict: "organization_id,external_id" });

  // users (best effort — 403 on /v3-style keys is fine; ignore)
  try {
    const users = await client.getUsers();
    if (users.length > 0) {
      await supabase.from("amocrm_users").upsert(
        users.map((u) => ({ organization_id: org, external_id: u.id, name: u.name, email: u.email })),
        { onConflict: "organization_id,external_id" },
      );
    }
  } catch {
    /* users endpoint optional */
  }

  // ── changed leads (incremental, bounded) ─────────────────────────────────
  const rowFor = (l: AmoLead) => {
    const openCount = openCountByPipeline.get(l.pipelineId) ?? 1;
    const currentRank = rankByStatus.get(l.statusId) ?? null;
    const reachedRank = l.isWon ? openCount : Math.min(Math.max(currentRank ?? 1, 1), openCount);
    return {
      organization_id: org,
      external_id: String(l.id),
      source: "amocrm" as const,
      pipeline: pipelineName.get(l.pipelineId) ?? null,
      pipeline_external_id: l.pipelineId,
      stage: stageNameByStatus.get(l.statusId) ?? null,
      status_external_id: l.statusId,
      status: l.isWon ? "won" : l.isLost ? "lost" : "open",
      is_won: l.isWon,
      is_lost: l.isLost,
      title: l.name,
      price: l.price,
      responsible: l.responsibleUserId != null ? String(l.responsibleUserId) : null,
      reached_rank: reachedRank,
      loss_reason: l.lossReason,
      created_at_src: toISO(l.createdAt),
      stage_entered_at: toISO(l.updatedAt),
      closed_at: toISO(l.closedAt),
      raw: {},
    };
  };

  let leadCount = 0;
  for (const p of pipelines) {
    if (Date.now() >= deadline) break;
    for (let page = 1; page <= MAX_PAGES_PER_PIPELINE; page++) {
      if (Date.now() >= deadline) break;
      const { leads, isLast } = await client.getLeadsPage(
        { pipelineId: p.id, updatedFrom },
        page,
      );
      if (leads.length > 0) {
        const rows = leads.map(rowFor);
        for (const batch of chunk(rows, 500)) {
          const { error } = await supabase
            .from("leads")
            .upsert(batch, { onConflict: "organization_id,source,external_id" });
          if (error) throw new Error(`leads upsert: ${error.message}`);
        }
        leadCount += rows.length;
      }
      if (isLast) break;
    }
  }

  // ── changed contacts → phone→responsible index (bounded) ─────────────────
  let phoneCount = 0;
  for (let page = 1; page <= MAX_CONTACT_PAGES; page++) {
    if (Date.now() >= deadline) break;
    const { contacts, isLast } = await client.getContactsPage(page, { updatedFrom });
    if (contacts.length > 0) phoneCount += await upsertContactPhones(supabase, org, contacts);
    if (isLast) break;
  }

  // ── open-task snapshot (uses leftover time within this org's deadline) ────
  // Cheap when out of time: it just fetches 0 pages and keeps the old snapshot.
  let taskCount = 0;
  try {
    const t = await syncOpenTasks(supabase, org, client, { deadline });
    taskCount = t.synced;
  } catch (err) {
    console.warn(`[cron sync] org=${org} tasks failed:`, err instanceof Error ? err.message : err);
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("integrations")
    .update({ status: "CONNECTED", last_synced_at: nowIso, last_auto_synced_at: nowIso })
    .eq("organization_id", org)
    .eq("provider", "amocrm");

  console.log(
    `[cron sync] org=${org}: воронок=${pipelines.length}, обновлено сделок=${leadCount}, ` +
      `телефонов=${phoneCount}, задач=${taskCount}`,
  );
  return { organizationId: org, leads: leadCount, pipelines: pipelines.length };
}

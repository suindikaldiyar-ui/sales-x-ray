import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAmoApiClient,
  quantizeTo10Min,
  type AmoApiClient,
  type AmoCrmConfig,
  type AmoLead,
} from "./amocrm";
import { upsertContactPhones } from "./amocrm-phones";

// ── window config ──────────────────────────────────────────────────────────
/** Default sync window (days). Override with SYNC_WINDOW_DAYS; full = 365. */
export const DEFAULT_WINDOW_DAYS = Number(process.env.SYNC_WINDOW_DAYS) || 30;
export const FULL_WINDOW_DAYS = 365;

// ── batch tuning (keep EACH request short — ≤~25s — so it never 500s) ──────
// Deliberately tiny: one /api/sync/amocrm call processes only a few pages,
// persists the cursor, and returns 200. The client loops until done.
const PAGE_CONCURRENCY = 3; // pages per wave (pacing is global in the client)
const LEAD_BATCH_PAGES = 4; // ≈ 1 000 leads per request
const EVENT_BATCH_PAGES = 8; // ≈ 800 events per request
const CONTACT_BATCH_PAGES = 6; // ≈ 1 500 contacts per request (phones index)
const SOFT_DEADLINE_MS = 22_000; // stop before a new wave once this is reached

/** Thrown for unrecoverable config problems (→ HTTP 400, not resumable). */
export class SyncConfigError extends Error {}

export interface SyncProgress {
  status: "running" | "done" | "error";
  phase: "pipelines" | "leads" | "events" | "contacts" | "done";
  done: boolean;
  progress: number; // 0..1 (soft estimate)
  leadsSynced: number;
  eventsProcessed: number;
  windowDays: number;
  message: string | null;
}

interface SyncStateRow {
  status: string;
  phase: string;
  window_days: number;
  date_from: number | null;
  cursor_pipeline: number;
  cursor_page: number;
  leads_synced: number;
  events_processed: number;
  message: string | null;
}

interface Catalog {
  pipelines: { externalId: number; name: string }[];
  openCountByPipeline: Map<number, number>;
  rankByStatus: Map<number, number>;
  stageNameByStatus: Map<number, string>;
}

const toISO = (sec: number | null | undefined): string | null =>
  sec ? new Date(sec * 1000).toISOString() : null;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadConfig(
  supabase: SupabaseClient,
  org: string,
): Promise<AmoCrmConfig> {
  const { data, error } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", org)
    .eq("provider", "amocrm")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const config = (data?.config ?? {}) as Partial<AmoCrmConfig>;
  if (!config.base_url || !config.access_token) {
    throw new SyncConfigError(
      "amoCRM не подключён: заполните адрес и токен на странице «Интеграции».",
    );
  }
  return config as AmoCrmConfig;
}

async function loadCatalog(
  supabase: SupabaseClient,
  org: string,
): Promise<Catalog> {
  const [{ data: pipes }, { data: stages }] = await Promise.all([
    supabase
      .from("amocrm_pipelines")
      .select("external_id, name, sort")
      .eq("organization_id", org)
      .order("sort", { ascending: true }),
    supabase
      .from("amocrm_stages")
      .select("pipeline_external_id, external_id, name, rank")
      .eq("organization_id", org),
  ]);

  const openCountByPipeline = new Map<number, number>();
  const rankByStatus = new Map<number, number>();
  const stageNameByStatus = new Map<number, string>();
  for (const s of (stages as any[]) ?? []) {
    stageNameByStatus.set(s.external_id, s.name);
    if (s.rank != null) {
      rankByStatus.set(s.external_id, s.rank);
      openCountByPipeline.set(
        s.pipeline_external_id,
        (openCountByPipeline.get(s.pipeline_external_id) ?? 0) + 1,
      );
    }
  }
  return {
    pipelines: ((pipes as any[]) ?? []).map((p) => ({
      externalId: p.external_id,
      name: p.name,
    })),
    openCountByPipeline,
    rankByStatus,
    stageNameByStatus,
  };
}

async function saveState(
  supabase: SupabaseClient,
  org: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("sync_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("provider", "amocrm");
}

/** Phase 0: fetch the catalog and reset the cursor (a fresh full/quick run). */
async function initSync(
  supabase: SupabaseClient,
  org: string,
  client: AmoApiClient,
  full: boolean,
): Promise<void> {
  const windowDays = full ? FULL_WINDOW_DAYS : DEFAULT_WINDOW_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const dateFrom = quantizeTo10Min(now - windowDays * 86400);

  const pipelines = await client.getPipelines();
  if (pipelines.length === 0) {
    throw new SyncConfigError("В amoCRM не найдено ни одной воронки.");
  }

  // Replace catalog + leads for a clean rebuild. Upserts below stay idempotent.
  await supabase.from("amocrm_pipelines").delete().eq("organization_id", org);
  await supabase.from("amocrm_stages").delete().eq("organization_id", org);
  await supabase
    .from("leads")
    .delete()
    .eq("organization_id", org)
    .eq("source", "amocrm");

  const { error: pErr } = await supabase.from("amocrm_pipelines").upsert(
    pipelines.map((p) => ({
      organization_id: org,
      external_id: p.id,
      name: p.name,
      is_main: p.isMain,
      sort: p.sort,
    })),
    { onConflict: "organization_id,external_id" },
  );
  if (pErr) throw new SyncConfigError(`Сохранение воронок: ${pErr.message}`);

  const rankByStatus = new Map<number, number>();
  for (const p of pipelines) {
    p.stages
      .filter((s) => !s.isWon && !s.isLost)
      .forEach((s, i) => rankByStatus.set(s.id, i + 1));
  }
  const stageRows = pipelines.flatMap((p) =>
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
  );
  // amoCRM repeats the system statuses 142/143 in EVERY pipeline with the same
  // global id, so we dedupe by external_id (the unique key) before upserting —
  // otherwise the same key appears multiple times in one statement.
  const seenStage = new Set<number>();
  const dedupedStages = stageRows.filter((r) =>
    seenStage.has(r.external_id) ? false : (seenStage.add(r.external_id), true),
  );
  for (const batch of chunk(dedupedStages, 500)) {
    const { error: sErr } = await supabase
      .from("amocrm_stages")
      .upsert(batch, { onConflict: "organization_id,external_id" });
    if (sErr) throw new SyncConfigError(`Сохранение этапов: ${sErr.message}`);
  }
  console.log(`[sync amocrm] этапов сохранено: ${dedupedStages.length}`);

  // Diagnostics: stages per pipeline (incl. system 142/143).
  for (const p of pipelines) {
    console.log(
      `[sync amocrm] pipeline "${p.name}" (#${p.id}): ${p.stages.length} этапов ` +
        `(${p.stages.filter((s) => !s.isWon && !s.isLost).length} открытых)`,
    );
  }

  // amoCRM users (managers) directory.
  const users = await client.getUsers();
  if (users.length > 0) {
    const seenUser = new Set<number>();
    const dedupedUsers = users.filter((u) =>
      seenUser.has(u.id) ? false : (seenUser.add(u.id), true),
    );
    const { error: uErr } = await supabase.from("amocrm_users").upsert(
      dedupedUsers.map((u) => ({
        organization_id: org,
        external_id: u.id,
        name: u.name,
        email: u.email,
      })),
      { onConflict: "organization_id,external_id" },
    );
    if (uErr) throw new SyncConfigError(`Сохранение менеджеров: ${uErr.message}`);
  }
  console.log(`[sync amocrm] пользователей (менеджеров) сохранено: ${users.length}`);

  // Reset / create the cursor.
  await supabase.from("sync_state").upsert(
    {
      organization_id: org,
      provider: "amocrm",
      status: "running",
      phase: "leads",
      window_days: windowDays,
      date_from: dateFrom,
      cursor_pipeline: 0,
      cursor_page: 1,
      leads_synced: 0,
      events_processed: 0,
      message: null,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );

  await supabase
    .from("integrations")
    .update({ status: "CONNECTED" })
    .eq("organization_id", org)
    .eq("provider", "amocrm");
}

function leadRow(l: AmoLead, org: string, catalog: Catalog) {
  const openCount = catalog.openCountByPipeline.get(l.pipelineId) ?? 1;
  const currentRank = catalog.rankByStatus.get(l.statusId) ?? null;
  let reachedRank: number;
  if (l.isWon) reachedRank = openCount;
  else reachedRank = Math.min(Math.max(currentRank ?? 1, 1), openCount);
  return {
    organization_id: org,
    external_id: String(l.id),
    source: "amocrm" as const,
    pipeline: catalog.pipelines.find((p) => p.externalId === l.pipelineId)?.name ?? null,
    pipeline_external_id: l.pipelineId,
    stage: catalog.stageNameByStatus.get(l.statusId) ?? null,
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
}

async function processLeadsBatch(
  supabase: SupabaseClient,
  org: string,
  client: AmoApiClient,
  state: SyncStateRow,
  catalog: Catalog,
  deadline: number,
): Promise<void> {
  const dateFrom = state.date_from ?? undefined;
  let pagesDone = 0;

  while (pagesDone < LEAD_BATCH_PAGES) {
    // Deadline is checked BEFORE every wave — never start work we can't finish
    // comfortably within the request budget.
    if (Date.now() >= deadline) {
      console.log(
        `[sync amocrm] phase=leads pipeline=${state.cursor_pipeline} page=${state.cursor_page} saved=${state.leads_synced} deadline-hit=true`,
      );
      return;
    }
    if (state.cursor_pipeline >= catalog.pipelines.length) {
      state.phase = "events";
      state.cursor_page = 1;
      break;
    }
    const pipeline = catalog.pipelines[state.cursor_pipeline];

    const waveSize = Math.min(PAGE_CONCURRENCY, LEAD_BATCH_PAGES - pagesDone);
    const pages = Array.from({ length: waveSize }, (_, i) => state.cursor_page + i);
    const results = await Promise.all(
      pages.map((p) => client.getLeadsPage({ pipelineId: pipeline.externalId, dateFrom }, p)),
    );

    const rows = results.flatMap((r) => r.leads).map((l) => leadRow(l, org, catalog));
    if (rows.length > 0) {
      const { error } = await supabase
        .from("leads")
        .upsert(rows, { onConflict: "organization_id,source,external_id" });
      if (error) throw new Error(`Сохранение сделок: ${error.message}`);
      state.leads_synced += rows.length;
    }

    pagesDone += pages.length;
    const hitLast = results.some((r) => r.isLast);
    if (hitLast) {
      state.cursor_pipeline += 1;
      state.cursor_page = 1;
    } else {
      state.cursor_page += pages.length;
    }

    await saveState(supabase, org, {
      phase: state.phase,
      cursor_pipeline: state.cursor_pipeline,
      cursor_page: state.cursor_page,
      leads_synced: state.leads_synced,
    });

    console.log(
      `[sync amocrm] phase=leads pipeline=${state.cursor_pipeline} page=${state.cursor_page} saved=${state.leads_synced} deadline-hit=false`,
    );

    if (state.cursor_pipeline >= catalog.pipelines.length) {
      state.phase = "events";
      state.cursor_page = 1;
      break;
    }
  }
}

async function processEventsBatch(
  supabase: SupabaseClient,
  org: string,
  client: AmoApiClient,
  state: SyncStateRow,
  catalog: Catalog,
  deadline: number,
): Promise<void> {
  const dateFrom = state.date_from ?? undefined;
  let pagesDone = 0;

  while (pagesDone < EVENT_BATCH_PAGES) {
    if (Date.now() >= deadline) {
      console.log(
        `[sync amocrm] phase=events page=${state.cursor_page} events=${state.events_processed} deadline-hit=true`,
      );
      return;
    }
    const waveSize = Math.min(PAGE_CONCURRENCY, EVENT_BATCH_PAGES - pagesDone);
    const pages = Array.from({ length: waveSize }, (_, i) => state.cursor_page + i);
    const results = await Promise.all(
      pages.map((p) => client.getStageHitsPage(dateFrom, p)),
    );

    // Furthest reached rank per lead within this wave.
    const maxRank = new Map<string, number>();
    let hitCount = 0;
    for (const r of results) {
      for (const h of r.hits) {
        hitCount += 1;
        const rank = catalog.rankByStatus.get(h.statusId);
        if (rank == null) continue;
        const id = String(h.leadId);
        maxRank.set(id, Math.max(maxRank.get(id) ?? 0, rank));
      }
    }
    if (maxRank.size > 0) {
      const ids = [...maxRank.keys()];
      const ranks = ids.map((id) => maxRank.get(id)!);
      const { error } = await supabase.rpc("apply_reached_ranks", {
        p_org: org,
        p_lead_ids: ids,
        p_ranks: ranks,
      });
      if (error) throw new Error(`Реконструкция этапов: ${error.message}`);
    }

    state.events_processed += hitCount;
    pagesDone += pages.length;
    const hitLast = results.some((r) => r.isLast);
    if (hitLast) {
      state.phase = "contacts";
      state.cursor_page = 1;
    } else {
      state.cursor_page += pages.length;
    }

    await saveState(supabase, org, {
      phase: state.phase,
      cursor_page: state.cursor_page,
      events_processed: state.events_processed,
    });

    console.log(
      `[sync amocrm] phase=events page=${state.cursor_page} events=${state.events_processed} deadline-hit=false`,
    );

    if (state.phase === "contacts") break;
  }
}

/** Contacts phase — page contacts, index their phones → responsible manager. */
async function processContactsBatch(
  supabase: SupabaseClient,
  org: string,
  client: AmoApiClient,
  state: SyncStateRow,
  deadline: number,
): Promise<void> {
  let pagesDone = 0;

  while (pagesDone < CONTACT_BATCH_PAGES) {
    if (Date.now() >= deadline) {
      console.log(`[sync amocrm] phase=contacts page=${state.cursor_page} deadline-hit=true`);
      return;
    }
    const waveSize = Math.min(PAGE_CONCURRENCY, CONTACT_BATCH_PAGES - pagesDone);
    const pages = Array.from({ length: waveSize }, (_, i) => state.cursor_page + i);
    const results = await Promise.all(pages.map((p) => client.getContactsPage(p)));

    const contacts = results.flatMap((r) => r.contacts);
    if (contacts.length > 0) await upsertContactPhones(supabase, org, contacts);

    pagesDone += pages.length;
    const hitLast = results.some((r) => r.isLast);
    if (hitLast) state.phase = "done";
    else state.cursor_page += pages.length;

    await saveState(supabase, org, { phase: state.phase, cursor_page: state.cursor_page });
    console.log(
      `[sync amocrm] phase=contacts page=${state.cursor_page} deadline-hit=false`,
    );
    if (state.phase === "done") break;
  }
}

/** One-time diagnostic dump after a sync finishes — verifies what landed. */
async function logFinalDiagnostics(
  supabase: SupabaseClient,
  org: string,
): Promise<void> {
  // Stage catalog → name, order (open by rank, then won 142, then lost 143).
  const { data: stageRows } = await supabase
    .from("amocrm_stages")
    .select("external_id, name, rank, is_won, is_lost")
    .eq("organization_id", org);
  const stages = (stageRows as any[]) ?? [];
  const ordered = [...stages].sort((a, b) => {
    const ao = a.is_won ? 2 : a.is_lost ? 3 : 1;
    const bo = b.is_won ? 2 : b.is_lost ? 3 : 1;
    if (ao !== bo) return ao - bo;
    return (a.rank ?? 0) - (b.rank ?? 0);
  });

  // Paginate the whole leads set, tallying by stage.
  const dist = new Map<number, number>();
  let total = 0;
  let withoutStatus = 0;
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("leads")
      .select("status_external_id")
      .eq("organization_id", org)
      .eq("source", "amocrm")
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error || !data) break;
    for (const r of data as any[]) {
      total += 1;
      const id = r.status_external_id as number | null;
      if (id == null) withoutStatus += 1;
      else dist.set(id, (dist.get(id) ?? 0) + 1);
    }
    if (data.length < size) break;
  }

  const { count: userCount } = await supabase
    .from("amocrm_users")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", org);

  const parts = ordered.map((s) => {
    const n = dist.get(s.external_id) ?? 0;
    const label =
      s.external_id === 142
        ? "Успешно(142)"
        : s.external_id === 143
          ? "Закрыто(143)"
          : s.name;
    return `${label}=${n}`;
  });

  console.log(`[sync amocrm] этапов сохранено: ${stages.length}`);
  console.log(`[sync amocrm] сделок всего: ${total}, без status_id: ${withoutStatus}`);
  console.log(`[sync amocrm] распределение по этапам: ${parts.join(", ")}`);
  console.log(`[sync amocrm] менеджеров сохранено: ${userCount ?? 0}`);
}

function computeProgress(state: SyncStateRow): number {
  if (state.phase === "done") return 1;
  if (state.phase === "leads")
    return Math.min(0.55, 0.08 + state.leads_synced / (state.leads_synced + 8000));
  if (state.phase === "events")
    return 0.5 + 0.35 * (state.events_processed / (state.events_processed + 15000));
  if (state.phase === "contacts") return 0.9;
  return 0.04;
}

/**
 * Process ONE bounded batch of the sync and return progress. Designed to be
 * called repeatedly by the client until `done`. The cursor is persisted after
 * every wave, so a timeout or transient amoCRM error just pauses progress —
 * the next call resumes from where it left off. Large accounts (16k+ leads)
 * complete across several quick calls instead of one long request that 500s.
 */
export async function runSyncBatch(
  supabase: SupabaseClient,
  org: string,
  opts: { start?: boolean; full?: boolean },
): Promise<SyncProgress> {
  const config = await loadConfig(supabase, org);
  const client = createAmoApiClient(config);

  // (Re)start: rebuild catalog + reset cursor.
  if (opts.start) {
    await initSync(supabase, org, client, Boolean(opts.full));
  }

  // Load (or lazily start) the cursor.
  let { data: row } = await supabase
    .from("sync_state")
    .select(
      "status, phase, window_days, date_from, cursor_pipeline, cursor_page, leads_synced, events_processed, message",
    )
    .eq("organization_id", org)
    .eq("provider", "amocrm")
    .maybeSingle();

  if (!row) {
    await initSync(supabase, org, client, Boolean(opts.full));
    ({ data: row } = await supabase
      .from("sync_state")
      .select(
        "status, phase, window_days, date_from, cursor_pipeline, cursor_page, leads_synced, events_processed, message",
      )
      .eq("organization_id", org)
      .eq("provider", "amocrm")
      .maybeSingle());
  }

  const state = row as SyncStateRow;

  // Already finished and not restarting → report done.
  if (state.phase === "done" || state.status === "done") {
    return {
      status: "done",
      phase: "done",
      done: true,
      progress: 1,
      leadsSynced: state.leads_synced,
      eventsProcessed: state.events_processed,
      windowDays: state.window_days,
      message: state.message,
    };
  }

  const catalog = await loadCatalog(supabase, org);
  const deadline = Date.now() + SOFT_DEADLINE_MS;

  if (state.phase === "leads") {
    await processLeadsBatch(supabase, org, client, state, catalog, deadline);
  }
  if (state.phase === "events") {
    await processEventsBatch(supabase, org, client, state, catalog, deadline);
  }
  if (state.phase === "contacts") {
    await processContactsBatch(supabase, org, client, state, deadline);
  }

  const finished = state.phase === "done";
  if (finished) {
    await saveState(supabase, org, {
      status: "done",
      phase: "done",
      message: `Готово: ${state.leads_synced} сделок за ${state.window_days} дн.`,
    });
    await supabase
      .from("integrations")
      .update({ status: "CONNECTED", last_synced_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("provider", "amocrm");
    try {
      await logFinalDiagnostics(supabase, org);
    } catch (err) {
      console.warn("[sync amocrm] diagnostics failed:", err);
    }
  } else {
    await saveState(supabase, org, { status: "running" });
  }

  return {
    status: finished ? "done" : "running",
    phase: state.phase as SyncProgress["phase"],
    done: finished,
    progress: computeProgress(state),
    leadsSynced: state.leads_synced,
    eventsProcessed: state.events_processed,
    windowDays: state.window_days,
    message: finished ? `Готово: ${state.leads_synced} сделок` : null,
  };
}

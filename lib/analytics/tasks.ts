import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TasksData {
  connected: boolean;
  overdue: number;
  dueToday: number;
  leadsWithoutTasks: number;
}

const EMPTY: TasksData = { connected: false, overdue: 0, dueToday: 0, leadsWithoutTasks: 0 };

// Almaty is UTC+5 (no DST); "today" is the calendar day there, as UTC instants.
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

/** [start, end] UTC instants of the Almaty calendar day containing `now`. */
function almatyTodayBounds(now: Date): { from: string; to: string } {
  const shifted = new Date(now.getTime() + ALMATY_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  const start = new Date(shifted.getTime() - ALMATY_OFFSET_MS);
  const end = new Date(start.getTime() + 86400000 - 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** The org's active funnel — same choice the dashboard makes: the main pipeline,
 * else the one with the most leads, else the first. Task metrics are scoped to
 * it so they match amoCRM's per-funnel numbers (not every dead/parked pipeline). */
async function resolveMainPipeline(
  supabase: SupabaseClient,
  org: string,
): Promise<number | null> {
  const { data: pls } = await supabase
    .from("amocrm_pipelines")
    .select("external_id, is_main")
    .eq("organization_id", org);
  const rows = (pls as { external_id: number; is_main: boolean }[]) ?? [];
  if (rows.length === 0) return null;

  const main = rows.find((p) => p.is_main);
  if (main) return main.external_id;

  let best: number | null = null;
  let bestCount = -1;
  for (const p of rows) {
    const { count } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("source", "amocrm")
      .eq("pipeline_external_id", p.external_id);
    if ((count ?? 0) > bestCount) {
      bestCount = count ?? 0;
      best = p.external_id;
    }
  }
  return best;
}

/**
 * Task diagnostics from the open-task snapshot (a current snapshot, not period-
 * bound), scoped to the org's active funnel so the numbers match amoCRM:
 *   - overdue: open tasks past due on an OPEN lead of the funnel
 *   - dueToday: open tasks due within the Almaty calendar day, same scope
 *   - leadsWithoutTasks: OPEN leads of the funnel with no task at all
 * Aggregation runs in Postgres via report_tasks (membership-guarded). Scoped to
 * `org`. Returns a hidden/empty result when amoCRM isn't connected or the
 * report_tasks(uuid,bigint,…) signature isn't deployed yet.
 */
export async function getTasksData(
  supabase: SupabaseClient,
  org: string,
): Promise<TasksData> {
  const { data: integration } = await supabase
    .from("integrations")
    .select("status")
    .eq("organization_id", org)
    .eq("provider", "amocrm")
    .maybeSingle();
  if (integration?.status !== "CONNECTED") return EMPTY;

  const pipeline = await resolveMainPipeline(supabase, org);
  if (pipeline == null) return { ...EMPTY, connected: true };

  const { from, to } = almatyTodayBounds(new Date());

  const { data, error } = await supabase.rpc("report_tasks", {
    p_org: org,
    p_pipeline: pipeline,
    p_today_from: from,
    p_today_to: to,
  });
  if (error) {
    // e.g. migration 0023 not applied yet — hide the block rather than show zeros.
    console.error("[tasks] report_tasks RPC error:", error.message);
    return EMPTY;
  }
  const r = ((data as any[]) ?? [])[0] ?? {};
  return {
    connected: true,
    overdue: Number(r.overdue ?? 0),
    dueToday: Number(r.due_today ?? 0),
    leadsWithoutTasks: Number(r.leads_without_tasks ?? 0),
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRange } from "@/lib/period-range";

export interface TasksData {
  connected: boolean;
  overdue: number;
  dueToday: number;
  leadsWithoutTasks: number;
}

const EMPTY: TasksData = { connected: false, overdue: 0, dueToday: 0, leadsWithoutTasks: 0 };

/**
 * Task diagnostics from the open-task snapshot (a current snapshot, not period-
 * bound): overdue tasks, tasks due today (Asia/Almaty), and open leads with no
 * task. All aggregation runs in Postgres via report_tasks (membership-guarded).
 * Scoped to `org`.
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

  // "Today" boundaries in Asia/Almaty (same helper the dashboard uses).
  const range = resolveRange({ period: "today" });
  const from = range.from ? range.from.toISOString() : null;
  const to = range.to ? range.to.toISOString() : null;

  const { data, error } = await supabase.rpc("report_tasks", {
    p_org: org,
    p_today_from: from,
    p_today_to: to,
  });
  if (error) {
    // e.g. migration not applied yet — hide the block rather than show zeros.
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

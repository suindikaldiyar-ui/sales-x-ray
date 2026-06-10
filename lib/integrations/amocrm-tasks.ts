import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmoApiClient } from "./amocrm";

// Safety cap on pages fetched in a single run (250 tasks/page). The real bound
// is usually the caller's deadline; this just prevents an unbounded loop.
const MAX_TASK_PAGES = 80; // ≈ 20k open tasks

const toISO = (sec: number | null | undefined): string | null =>
  sec ? new Date(sec * 1000).toISOString() : null;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface TasksSyncResult {
  synced: number;
  complete: boolean;
  pages: number;
}

interface TaskRow {
  organization_id: string;
  external_id: string;
  lead_external_id: string | null;
  complete_till: string | null;
  responsible_user_id: number | null;
}

/**
 * Refresh the per-org snapshot of OPEN amoCRM tasks. Pages through
 * `/api/v4/tasks?filter[is_completed]=0&filter[entity_type]=leads`, bounded by
 * the caller's `deadline` and a page cap. The snapshot is REPLACED (delete +
 * insert) only when the full set was fetched (`isLast` reached) — a partial run
 * leaves the previous snapshot intact and is simply retried next run, so the
 * data never ends up half-updated. Scoped to `org`; runs under the service role
 * in the cron and the user client in the manual sync (both fine).
 */
export async function syncOpenTasks(
  supabase: SupabaseClient,
  org: string,
  client: AmoApiClient,
  opts: { deadline: number; maxPages?: number },
): Promise<TasksSyncResult> {
  const maxPages = opts.maxPages ?? MAX_TASK_PAGES;
  const rows: TaskRow[] = [];
  let complete = false;
  let page = 1;

  for (; page <= maxPages; page++) {
    if (Date.now() >= opts.deadline) break;
    const { tasks, isLast } = await client.getTasksPage(page);
    for (const t of tasks) {
      rows.push({
        organization_id: org,
        external_id: String(t.id),
        lead_external_id: t.leadId != null ? String(t.leadId) : null,
        complete_till: toISO(t.completeTill),
        responsible_user_id: t.responsibleUserId,
      });
    }
    if (isLast) {
      complete = true;
      break;
    }
  }

  if (!complete) {
    console.log(
      `[amocrm tasks] org=${org} частично (${rows.length} задач, до стр ${page}) — ` +
        `снимок не заменён, продолжим в следующий прогон`,
    );
    return { synced: 0, complete: false, pages: page };
  }

  // Full set in hand → replace the org's open-task snapshot.
  const del = await supabase.from("amocrm_tasks").delete().eq("organization_id", org);
  if (del.error) throw new Error(`tasks delete: ${del.error.message}`);
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from("amocrm_tasks").insert(batch);
    if (error) throw new Error(`tasks insert: ${error.message}`);
  }

  console.log(`[amocrm tasks] org=${org} снимок обновлён: ${rows.length} открытых задач`);
  return { synced: rows.length, complete: true, pages: page };
}

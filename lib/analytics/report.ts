import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeReport,
  type AnalyticsLead,
  type AnalyticsStage,
  type FunnelReport,
} from "./funnel";
import {
  normalizePeriod,
  periodStart,
  type PeriodKey,
  type PipelineRef,
} from "@/lib/periods";

export interface ManagerStat {
  id: string;
  name: string;
  leads: number;
  won: number;
  lost: number;
  open: number;
  conversion: number;
  wonValue: number;
  topStages: { name: string; count: number }[];
}

export interface ReportData {
  connected: boolean;
  synced: boolean;
  lastSyncedAt: string | null;
  pipelines: PipelineRef[];
  selectedPipelineId: number | null;
  selectedPipelineName: string | null;
  period: PeriodKey;
  hasData: boolean;
  report: FunnelReport | null;
  /** Per-manager stats across ALL pipelines in the period. */
  managers: ManagerStat[];
  /** Total leads across all pipelines in the period. */
  totalLeadsInPeriod: number;
}

interface StageRow {
  pipeline_external_id: number;
  external_id: number;
  name: string;
  rank: number | null;
  is_won: boolean;
  is_lost: boolean;
}

interface LeadRow {
  pipeline_external_id: number | null;
  status_external_id: number | null;
  stage: string | null;
  is_won: boolean;
  is_lost: boolean;
  price: number | null;
  reached_rank: number | null;
  loss_reason: string | null;
  responsible: string | null;
  created_at_src: string | null;
  stage_entered_at: string | null;
}

const toSec = (iso: string | null): number =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : 0;

/** Read every row of a table for an org, paging past PostgREST's 1000 cap. */
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  apply: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await apply(
      supabase.from(table).select(columns).order("id", { ascending: true }),
    ).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/**
 * Assemble the dashboard/funnel/managers report from synced DB rows. ALL leads
 * are read (paginated) so totals, conversion and manager stats are complete —
 * never capped at 1000. RLS-scoped via the passed client.
 */
export async function getReportData(
  supabase: SupabaseClient,
  organizationId: string,
  opts: { period?: string | null; pipelineId?: string | null },
): Promise<ReportData> {
  const period = normalizePeriod(opts.period);

  const { data: integration } = await supabase
    .from("integrations")
    .select("status, last_synced_at")
    .eq("organization_id", organizationId)
    .eq("provider", "amocrm")
    .maybeSingle();

  const connected = integration?.status === "CONNECTED";
  const lastSyncedAt = (integration?.last_synced_at as string | null) ?? null;

  const { data: pipelineRows } = await supabase
    .from("amocrm_pipelines")
    .select("external_id, name, is_main, sort")
    .eq("organization_id", organizationId)
    .order("sort", { ascending: true });

  const base: ReportData = {
    connected,
    synced: false,
    lastSyncedAt,
    pipelines: [],
    selectedPipelineId: null,
    selectedPipelineName: null,
    period,
    hasData: false,
    report: null,
    managers: [],
    totalLeadsInPeriod: 0,
  };

  if (!pipelineRows || pipelineRows.length === 0) return base;
  base.synced = true;

  const [stages, leads, users] = await Promise.all([
    fetchAll<StageRow>(
      supabase,
      "amocrm_stages",
      "pipeline_external_id, external_id, name, rank, is_won, is_lost",
      (q) => q.eq("organization_id", organizationId),
    ),
    fetchAll<LeadRow>(
      supabase,
      "leads",
      "pipeline_external_id, status_external_id, stage, is_won, is_lost, price, reached_rank, loss_reason, responsible, created_at_src, stage_entered_at",
      (q) => q.eq("organization_id", organizationId).eq("source", "amocrm"),
    ),
    fetchAll<{ external_id: number; name: string }>(
      supabase,
      "amocrm_users",
      "external_id, name",
      (q) => q.eq("organization_id", organizationId),
    ),
  ]);

  const from = periodStart(period);
  const inPeriod = (l: LeadRow) => from == null || toSec(l.created_at_src) >= from;
  const periodLeads = leads.filter(inPeriod);
  base.totalLeadsInPeriod = periodLeads.length;

  // ── pipelines + selection (counts from the full set) ─────────────────────
  const countByPipeline = new Map<number, number>();
  for (const l of periodLeads) {
    if (l.pipeline_external_id == null) continue;
    countByPipeline.set(
      l.pipeline_external_id,
      (countByPipeline.get(l.pipeline_external_id) ?? 0) + 1,
    );
  }
  const pipelines: PipelineRef[] = pipelineRows.map((p: any) => ({
    id: p.external_id as number,
    name: p.name as string,
    leadCount: countByPipeline.get(p.external_id) ?? 0,
  }));
  const mainId = (pipelineRows.find((p: any) => p.is_main) as any)?.external_id;
  const requested = opts.pipelineId ? Number(opts.pipelineId) : NaN;
  const selected =
    pipelines.find((p) => p.id === requested) ??
    pipelines.find((p) => p.id === mainId) ??
    [...pipelines].sort((a, b) => b.leadCount - a.leadCount)[0] ??
    pipelines[0];

  base.pipelines = pipelines;
  base.selectedPipelineId = selected.id;
  base.selectedPipelineName = selected.name;

  // ── funnel for the selected pipeline ─────────────────────────────────────
  const openStages: AnalyticsStage[] = stages
    .filter((s) => s.pipeline_external_id === selected.id && s.rank != null)
    .map((s) => ({ name: s.name, rank: s.rank as number }))
    .sort((a, b) => a.rank - b.rank);

  const rankByStatus = new Map<number, number>();
  for (const s of stages) {
    if (s.pipeline_external_id === selected.id && s.rank != null) {
      rankByStatus.set(s.external_id, s.rank);
    }
  }

  const scopedLeads = periodLeads.filter((l) => l.pipeline_external_id === selected.id);
  const analyticsLeads: AnalyticsLead[] = scopedLeads.map((l) => ({
    reachedRank: l.reached_rank,
    statusRank:
      l.status_external_id != null ? rankByStatus.get(l.status_external_id) ?? null : null,
    stageName: l.stage,
    isWon: l.is_won,
    isLost: l.is_lost,
    price: l.price ?? 0,
    createdAtSec: toSec(l.created_at_src),
    stageEnteredAtSec: l.stage_entered_at ? toSec(l.stage_entered_at) : null,
    lossReason: l.loss_reason,
  }));

  base.hasData = analyticsLeads.length > 0;
  const report = computeReport(openStages, analyticsLeads);
  base.report = report;

  // ── diagnostics: current (kanban) distribution + reconciliation ──────────
  // "Сейчас на этапе" should match the amoCRM kanban; current(open) + won(142)
  // + lost(143) should ≈ total leads in the period for this pipeline.
  const currentSum = report.funnel.reduce((a, s) => a + s.current, 0);
  const reconciled = currentSum + report.wonCount + report.lostCount;
  const distLine = report.funnel.map((s) => `${s.name}=${s.current}`).join(", ");
  console.log(
    `[report] воронка "${selected.name}" период=${period}: всего=${report.totalLeads}, ` +
      `сейчас-в-открытых=${currentSum}, Успешно(142)=${report.wonCount}, ` +
      `Закрыто(143)=${report.lostCount}, сумма(сейчас+142+143)=${reconciled}`,
  );
  console.log(
    `[report] текущее распределение (сверка с amoCRM): ${distLine}, ` +
      `Успешно(142)=${report.wonCount}, Закрыто(143)=${report.lostCount}`,
  );

  // ── managers across ALL pipelines in the period ──────────────────────────
  base.managers = aggregateManagers(periodLeads, users);

  return base;
}

interface ManagerAcc {
  id: string;
  name: string;
  leads: number;
  won: number;
  lost: number;
  open: number;
  wonValue: number;
  byStage: Map<string, number>;
}

function aggregateManagers(
  leads: LeadRow[],
  users: { external_id: number; name: string }[],
): ManagerStat[] {
  const nameById = new Map<string, string>(
    users.map((u) => [String(u.external_id), u.name]),
  );

  const acc = new Map<string, ManagerAcc>();
  for (const l of leads) {
    const id = l.responsible ?? "—";
    const name = l.responsible
      ? nameById.get(l.responsible) ?? `ID ${l.responsible}`
      : "Без ответственного";
    let m = acc.get(id);
    if (!m) {
      m = { id, name, leads: 0, won: 0, lost: 0, open: 0, wonValue: 0, byStage: new Map() };
      acc.set(id, m);
    }
    m.leads += 1;
    if (l.is_won) {
      m.won += 1;
      m.wonValue += l.price ?? 0;
    } else if (l.is_lost) {
      m.lost += 1;
    } else {
      m.open += 1;
    }
    const stage = l.stage ?? "—";
    m.byStage.set(stage, (m.byStage.get(stage) ?? 0) + 1);
  }

  return [...acc.values()]
    .map((m) => ({
      id: m.id,
      name: m.name,
      leads: m.leads,
      won: m.won,
      lost: m.lost,
      open: m.open,
      conversion: m.leads > 0 ? Math.round((m.won / m.leads) * 1000) / 10 : 0,
      wonValue: m.wonValue,
      topStages: [...m.byStage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.leads - a.leads);
}

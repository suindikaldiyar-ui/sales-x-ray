import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assembleReport,
  type FunnelReport,
  type HeadlineAgg,
  type StageAgg,
  type LossReasonStat,
} from "./funnel";
import {
  normalizePeriod,
  periodDays,
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

export interface ReportShell {
  connected: boolean;
  synced: boolean;
  lastSyncedAt: string | null;
  pipelines: PipelineRef[];
  selectedPipelineId: number | null;
  selectedPipelineName: string | null;
  period: PeriodKey;
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
  managers: ManagerStat[];
  totalLeadsInPeriod: number;
}

const num = (x: unknown): number => Number(x ?? 0);

interface PipelineAggRow {
  external_id: number;
  name: string;
  is_main: boolean;
  lead_count: number | string;
}

async function loadShellRaw(
  supabase: SupabaseClient,
  org: string,
  opts: { period?: string | null; pipelineId?: string | null },
): Promise<{ shell: ReportShell; days: number | null; pipelineRows: PipelineAggRow[] }> {
  const period = normalizePeriod(opts.period);
  const days = periodDays(period);

  const { data: integration } = await supabase
    .from("integrations")
    .select("status, last_synced_at")
    .eq("organization_id", org)
    .eq("provider", "amocrm")
    .maybeSingle();
  const connected = integration?.status === "CONNECTED";
  const lastSyncedAt = (integration?.last_synced_at as string | null) ?? null;

  const { data } = await supabase.rpc("report_pipelines", { p_org: org, p_days: days });
  const pipelineRows = (data as PipelineAggRow[]) ?? [];

  if (pipelineRows.length === 0) {
    return {
      shell: {
        connected,
        synced: false,
        lastSyncedAt,
        pipelines: [],
        selectedPipelineId: null,
        selectedPipelineName: null,
        period,
      },
      days,
      pipelineRows,
    };
  }

  const pipelines: PipelineRef[] = pipelineRows.map((p) => ({
    id: p.external_id,
    name: p.name,
    leadCount: num(p.lead_count),
  }));
  const mainId = pipelineRows.find((p) => p.is_main)?.external_id;
  const requested = opts.pipelineId ? Number(opts.pipelineId) : NaN;
  const selected =
    pipelines.find((p) => p.id === requested) ??
    pipelines.find((p) => p.id === mainId) ??
    [...pipelines].sort((a, b) => b.leadCount - a.leadCount)[0] ??
    pipelines[0];

  return {
    shell: {
      connected,
      synced: true,
      lastSyncedAt,
      pipelines,
      selectedPipelineId: selected.id,
      selectedPipelineName: selected.name,
      period,
    },
    days,
    pipelineRows,
  };
}

/**
 * Lightweight shell — just enough to render the page header, the period/pipeline
 * filter bar and resolve the selected pipeline. The heavy aggregates stream in
 * separately via getReportData (kept behind a Suspense boundary).
 */
export async function getReportShell(
  supabase: SupabaseClient,
  org: string,
  opts: { period?: string | null; pipelineId?: string | null },
): Promise<ReportShell> {
  return (await loadShellRaw(supabase, org, opts)).shell;
}

/**
 * Full dashboard/funnel/managers data. All aggregation runs in Postgres via the
 * report_* RPCs (SECURITY DEFINER + membership guard), so Node only handles a
 * handful of small rows — no 16k-lead read. Numbers are identical to the old
 * in-Node computation.
 */
export async function getReportData(
  supabase: SupabaseClient,
  org: string,
  opts: { period?: string | null; pipelineId?: string | null },
): Promise<ReportData> {
  const { shell, days, pipelineRows } = await loadShellRaw(supabase, org, opts);

  const base: ReportData = {
    ...shell,
    hasData: false,
    report: null,
    managers: [],
    totalLeadsInPeriod: 0,
  };
  if (!shell.synced || shell.selectedPipelineId == null) return base;

  const pid = shell.selectedPipelineId;
  const [funnelRes, headRes, lossRes, mgrRes, mgrStageRes] = await Promise.all([
    supabase.rpc("report_funnel", { p_org: org, p_pipeline: pid, p_days: days }),
    supabase.rpc("report_headline", { p_org: org, p_pipeline: pid, p_days: days }),
    supabase.rpc("report_loss_reasons", { p_org: org, p_pipeline: pid, p_days: days }),
    supabase.rpc("report_managers", { p_org: org, p_days: days }),
    supabase.rpc("report_manager_stages", { p_org: org, p_days: days }),
  ]);

  const stageAggs: StageAgg[] = ((funnelRes.data as any[]) ?? []).map((r) => ({
    rank: num(r.rank),
    name: r.name,
    current: num(r.current_count),
    reachedExact: num(r.reached_exact),
    avgDays: num(r.avg_days),
    stuck: num(r.stuck),
  }));

  const h = ((headRes.data as any[]) ?? [])[0] ?? {};
  const headline: HeadlineAgg = {
    totalLeads: num(h.total_leads),
    wonCount: num(h.won_count),
    lostCount: num(h.lost_count),
    openCount: num(h.open_count),
    wonValue: num(h.won_value),
    lostValue: num(h.lost_value),
    atRiskValue: num(h.at_risk_value),
  };

  const lossReasons: LossReasonStat[] = ((lossRes.data as any[]) ?? []).map((r) => ({
    reason: r.reason,
    count: num(r.cnt),
    value: num(r.value),
  }));

  base.report = assembleReport(stageAggs, headline, lossReasons);
  base.hasData = headline.totalLeads > 0;
  base.totalLeadsInPeriod = pipelineRows.reduce((a, p) => a + num(p.lead_count), 0);
  base.managers = buildManagers(
    (mgrRes.data as any[]) ?? [],
    (mgrStageRes.data as any[]) ?? [],
  );

  // Compact reconciliation log (tiny — no per-lead read).
  const distLine = base.report.funnel.map((s) => `${s.name}=${s.current}`).join(", ");
  console.log(
    `[report] воронка "${shell.selectedPipelineName}" период=${shell.period}: ` +
      `всего=${headline.totalLeads}, Успешно(142)=${headline.wonCount}, ` +
      `Закрыто(143)=${headline.lostCount} | текущее распределение: ${distLine}`,
  );

  return base;
}

function buildManagers(mgrRows: any[], stageRows: any[]): ManagerStat[] {
  // Group the (responsible → stage → count) distribution for topStages.
  const stagesByResp = new Map<string, { name: string; count: number }[]>();
  for (const r of stageRows) {
    const arr = stagesByResp.get(r.responsible) ?? [];
    arr.push({ name: r.stage, count: num(r.cnt) });
    stagesByResp.set(r.responsible, arr);
  }

  return mgrRows
    .map((r) => {
      const leads = num(r.leads);
      const won = num(r.won);
      const tops = (stagesByResp.get(r.responsible) ?? [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);
      return {
        id: r.responsible,
        name: r.name,
        leads,
        won,
        lost: num(r.lost),
        open: num(r.open_count),
        conversion: leads > 0 ? Math.round((won / leads) * 1000) / 10 : 0,
        wonValue: num(r.won_value),
        topStages: tops,
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

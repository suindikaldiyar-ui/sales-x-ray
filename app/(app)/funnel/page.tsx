import { Suspense } from "react";
import Link from "next/link";
import { Filter, RefreshCw, AlertTriangle } from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getReportShell, getReportData } from "@/lib/analytics/report";
import { fmtMoney } from "@/lib/analytics/funnel";
import { formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { SyncButton } from "@/components/integrations/sync-button";
import { ReportSkeleton } from "@/components/app/report-skeleton";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Воронка — Sales X-Ray" };

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string; pipeline?: string };
}) {
  const tenant = await requireTenant();
  const canManage = canManageIntegrations(tenant.role);
  const supabase = createClient();
  const shell = await getReportShell(supabase, tenant.organization.id, {
    period: searchParams.period,
    from: searchParams.from,
    to: searchParams.to,
    pipelineId: searchParams.pipeline,
  });

  if (!shell.connected) {
    return (
      <>
        <PageHeader title="Воронка" description="Конверсия между этапами и узкие места." />
        <EmptyState
          icon={<Filter className="h-5 w-5" />}
          title="Подключите amoCRM"
          description="Воронка строится из ваших сделок amoCRM."
          action={canManage ? <Link href="/integrations"><Button>Перейти к интеграциям</Button></Link> : undefined}
        />
      </>
    );
  }
  if (!shell.synced) {
    return (
      <>
        <PageHeader title="Воронка" description="Конверсия между этапами и узкие места." />
        <EmptyState
          icon={<RefreshCw className="h-5 w-5" />}
          title="Запустите синхронизацию"
          description="Загрузите сделки из amoCRM, чтобы построить воронку."
          action={canManage ? <SyncButton /> : undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Воронка"
        description={`«${shell.selectedPipelineName}» · конверсия по позиционному рангу этапа`}
      />
      <div className="mb-6">
        <FilterBar pipelines={shell.pipelines} selectedPipelineId={shell.selectedPipelineId} />
      </div>

      <Suspense
        key={`${searchParams.period}-${searchParams.from}-${searchParams.to}-${shell.selectedPipelineId}`}
        fallback={<ReportSkeleton rows={6} />}
      >
        <FunnelData
          orgId={tenant.organization.id}
          period={searchParams.period}
          from={searchParams.from}
          to={searchParams.to}
          pipelineId={shell.selectedPipelineId}
        />
      </Suspense>
    </>
  );
}

async function FunnelData({
  orgId,
  period,
  from,
  to,
  pipelineId,
}: {
  orgId: string;
  period?: string;
  from?: string;
  to?: string;
  pipelineId: number | null;
}) {
  const supabase = createClient();
  const data = await getReportData(supabase, orgId, {
    period,
    from,
    to,
    pipelineId: pipelineId != null ? String(pipelineId) : undefined,
  });
  const r = data.report!;
  const hasData = data.hasData;
  const firstReached = r.funnel[0]?.reached ?? 0;

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-line bg-ink-700/40 p-8 text-center text-sm text-content-muted">
        За выбранный период в этой воронке нет сделок.
      </div>
    );
  }

  return (
    <>
      {r.bottleneck && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-signal-bad/25 bg-signal-bad/[0.07] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-signal-bad" />
          <div>
            <p className="text-sm font-medium text-content">Узкое место</p>
            <p className="mt-0.5 text-sm text-content-muted">{r.bottleneck.verdict}</p>
          </div>
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[1.4fr_repeat(5,_minmax(0,1fr))] gap-3 border-b border-line px-5 py-3 text-xs font-medium uppercase tracking-wider text-content-faint">
            <span>Этап</span>
            <span className="text-right text-xray">Сейчас на этапе</span>
            <span className="text-right">Дошло</span>
            <span className="text-right">Конверсия</span>
            <span className="text-right">Потеряно</span>
            <span className="text-right">Ср. дней</span>
          </div>
          {r.funnel.map((s) => {
            const pct = firstReached > 0 ? (s.reached / firstReached) * 100 : 0;
            const isBottleneck = r.bottleneck && r.bottleneck.toStage === s.name;
            return (
              <div
                key={s.rank}
                className="grid grid-cols-[1.4fr_repeat(5,_minmax(0,1fr))] items-center gap-3 border-b border-line px-5 py-4 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-content-faint">{s.rank}</span>
                    <span className="truncate font-medium text-content" title={s.name}>{s.name}</span>
                    {isBottleneck && <Badge tone="bad">узкое место</Badge>}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                    <div className="h-full rounded-full bg-gradient-to-r from-xray/40 to-xray" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="nums text-right text-lg font-semibold text-xray">{formatNumber(s.current)}</span>
                <span className="nums text-right font-medium text-content-muted">{formatNumber(s.reached)}</span>
                <span className="nums text-right text-content-muted">
                  {s.conversionFromPrev != null ? `${s.conversionFromPrev}%` : "—"}
                </span>
                <span className="nums text-right text-content-muted">
                  {s.lostFromPrev > 0 ? formatNumber(s.lostFromPrev) : "—"}
                </span>
                <span className="nums text-right text-content-muted">
                  {s.avgDaysOnStage > 0 ? s.avgDaysOnStage : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="mt-3 text-xs text-content-faint">
        «Сейчас на этапе» — сколько сделок стоит на этапе прямо сейчас (как в
        канбане amoCRM). «Дошло» — сколько сделок когда-либо достигали этапа
        (когортно); по нему считается конверсия и узкое место.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="panel-flat p-4">
          <p className="text-xs text-content-faint">Сейчас в открытых этапах</p>
          <p className="nums mt-1 font-display text-2xl font-bold text-content">
            {formatNumber(r.funnel.reduce((a, s) => a + s.current, 0))}
          </p>
        </div>
        <div className="panel-flat p-4">
          <p className="text-xs text-content-faint">Успешно (142)</p>
          <p className="nums mt-1 font-display text-2xl font-bold text-signal-good">{formatNumber(r.wonCount)}</p>
        </div>
        <div className="panel-flat p-4">
          <p className="text-xs text-content-faint">Закрыто / слив (143)</p>
          <p className="nums mt-1 font-display text-2xl font-bold text-signal-bad">{formatNumber(r.lostCount)}</p>
        </div>
      </div>

      {r.lossReasons.length > 0 && (
        <div className="mt-6">
          <Card>
            <CardHeader title="Причины потерь" subtitle="Почему сделки срываются" />
            <div className="space-y-2">
              {r.lossReasons.slice(0, 8).map((reason) => (
                <div
                  key={reason.reason}
                  className="flex items-center justify-between rounded-xl border border-line bg-ink-700/40 px-4 py-3"
                >
                  <span className="truncate text-sm text-content">{reason.reason}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="nums text-content-muted">{formatNumber(reason.count)} шт</span>
                    <span className="nums w-24 text-right text-content-faint">{fmtMoney(reason.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

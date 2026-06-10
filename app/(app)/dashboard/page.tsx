import { Suspense } from "react";
import Link from "next/link";
import {
  Filter,
  AlertTriangle,
  Lightbulb,
  RefreshCw,
  CheckCircle2,
  TrendingDown,
} from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getReportShell, getReportData } from "@/lib/analytics/report";
import { getTasksData } from "@/lib/analytics/tasks";
import { fmtMoney } from "@/lib/analytics/funnel";
import { formatNumber, cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { FilterBar } from "@/components/app/filter-bar";
import { SyncButton } from "@/components/integrations/sync-button";
import { ReportSkeleton } from "@/components/app/report-skeleton";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Дашборд — Sales X-Ray" };

function syncedAgo(iso: string | null): string {
  if (!iso) return "ещё не синхронизировано";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "обновлено только что";
  if (mins < 60) return `обновлено ${mins} мин назад`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `обновлено ${hrs} ч назад`;
  return `обновлено ${Math.round(hrs / 24)} дн назад`;
}

export default async function DashboardPage({
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
        <PageHeader
          title="Дашборд"
          description={`Сводка по продажам компании «${tenant.organization.name}».`}
        />
        <EmptyState
          icon={<Filter className="h-5 w-5" />}
          title="Подключите amoCRM"
          description="Дашборд оживёт, как только вы сохраните токен amoCRM и запустите синхронизацию."
          action={
            canManage ? (
              <Link href="/integrations">
                <Button>Перейти к интеграциям</Button>
              </Link>
            ) : (
              <p className="text-sm text-content-faint">Попросите владельца или РОПа подключить amoCRM.</p>
            )
          }
        />
      </>
    );
  }

  if (!shell.synced) {
    return (
      <>
        <PageHeader
          title="Дашборд"
          description={`Сводка по продажам компании «${tenant.organization.name}».`}
        />
        <EmptyState
          icon={<RefreshCw className="h-5 w-5" />}
          title="Запустите синхронизацию"
          description="amoCRM подключён. Загрузите сделки и историю, чтобы увидеть воронку и реальные цифры."
          action={canManage ? <SyncButton /> : undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Дашборд"
        description={`«${tenant.organization.name}» · воронка «${shell.selectedPipelineName}»`}
        action={
          <div className="flex flex-col items-end gap-1.5">
            <span className="flex items-center gap-1.5 text-xs text-content-faint">
              <CheckCircle2 className="h-3.5 w-3.5 text-signal-good" />
              {syncedAgo(shell.lastSyncedAt)}
            </span>
            {canManage && <SyncButton size="sm" variant="outline" />}
          </div>
        }
      />

      <div className="mb-6">
        <FilterBar pipelines={shell.pipelines} selectedPipelineId={shell.selectedPipelineId} />
      </div>

      <Suspense
        key={`${searchParams.period}-${searchParams.from}-${searchParams.to}-${shell.selectedPipelineId}`}
        fallback={<ReportSkeleton />}
      >
        <DashboardData
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

async function DashboardData({
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
  const [data, tasks] = await Promise.all([
    getReportData(supabase, orgId, {
      period,
      from,
      to,
      pipelineId: pipelineId != null ? String(pipelineId) : undefined,
    }),
    getTasksData(supabase, orgId),
  ]);
  const r = data.report!;
  const hasData = data.hasData;
  const firstReached = r.funnel[0]?.reached ?? 0;

  return (
    <>
      {!hasData && (
        <div className="mb-6 rounded-2xl border border-line bg-ink-700/40 p-4 text-sm text-content-muted">
          За выбранный период в этой воронке нет сделок. Попробуйте увеличить
          период или выбрать другую воронку.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Лидов за период" value={formatNumber(r.totalLeads)} placeholder={!hasData} />

        {/* Conversion: won-based only when the org actually uses won, otherwise
            funnel throughput to the deepest reached stage (no false 0%). */}
        {r.usesWon ? (
          <StatCard label="Конверсия в продажу" value={`${r.overallConversion}%`} accent="xray" placeholder={!hasData} />
        ) : (
          <StatCard
            label="Доходимость воронки"
            value={`${r.throughput?.pct ?? 0}%`}
            hint={hasData && r.throughput ? `дошли до «${r.throughput.stageName}»` : undefined}
            accent="xray"
            placeholder={!hasData}
          />
        )}

        {/* Won deals, or — for orgs that don't use won — how many reached the
            deepest stage of the funnel. */}
        {r.usesWon ? (
          <StatCard
            label="Выиграно сделок"
            value={formatNumber(r.wonCount)}
            hint={hasData ? fmtMoney(r.wonValue) : undefined}
            accent="good"
            placeholder={!hasData}
          />
        ) : (
          <StatCard
            label="Дошли до финала"
            value={formatNumber(r.throughput?.reached ?? 0)}
            hint={hasData && r.throughput ? `этап «${r.throughput.stageName}»` : undefined}
            accent="good"
            placeholder={!hasData}
          />
        )}

        {/* Lost money, or — without lost usage — deals currently in progress. */}
        {r.usesLost ? (
          <StatCard
            label="Упущенная сумма"
            value={fmtMoney(r.lostValue)}
            hint={hasData ? `${formatNumber(r.lostCount)} потеряно` : undefined}
            accent="bad"
            placeholder={!hasData}
          />
        ) : (
          <StatCard
            label="Сейчас в работе"
            value={formatNumber(r.openCount)}
            hint={hasData ? "открытых сделок" : undefined}
            placeholder={!hasData}
          />
        )}
      </div>

      {hasData && r.keyMetrics.some((m) => m.available) && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {r.keyMetrics
            .filter((m) => m.available)
            .map((m) => (
              <Card key={m.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-content-muted">{m.title}</p>
                    <p className="mt-0.5 text-xs text-content-faint">{m.subtitle}</p>
                  </div>
                  <Badge tone={m.tone === "good" ? "good" : m.tone === "warn" ? "warn" : "bad"}>
                    {m.conversion}%
                  </Badge>
                </div>
                <p
                  className={cn(
                    "nums mt-3 font-display text-3xl font-bold",
                    m.tone === "good" ? "text-signal-good" : m.tone === "warn" ? "text-signal-warn" : "text-signal-bad",
                  )}
                >
                  {formatNumber(m.toCount)}
                  <span className="text-base font-medium text-content-faint"> / {formatNumber(m.fromCount)}</span>
                </p>
                <p className="mt-2 text-sm text-content-muted">{m.verdict}</p>
              </Card>
            ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Воронка продаж"
            subtitle="Сейчас на этапе (как в amoCRM) · дошло когортно"
            action={
              <Link href="/funnel" className="text-sm font-medium text-xray hover:underline">
                Подробнее
              </Link>
            }
          />
          {r.funnel.length === 0 ? (
            <p className="py-8 text-center text-sm text-content-muted">В этой воронке нет открытых этапов.</p>
          ) : (
            <div className="space-y-3">
              {r.funnel.map((s) => {
                const pct = firstReached > 0 ? (s.reached / firstReached) * 100 : 0;
                return (
                  <div key={s.rank} className="flex items-center gap-4">
                    <div className="w-36 shrink-0 truncate text-sm text-content-muted" title={s.name}>
                      {s.name}
                    </div>
                    <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-ink-700">
                      <div
                        className="h-full rounded-lg bg-gradient-to-r from-xray/30 to-xray/70"
                        style={{ width: `${hasData ? pct : 0}%` }}
                      />
                      <span className="absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-content">
                        {hasData ? `${formatNumber(s.current)} сейчас` : "—"}
                      </span>
                    </div>
                    <div className="nums w-28 shrink-0 text-right text-xs text-content-faint">
                      {hasData ? (
                        <>
                          дошло {formatNumber(s.reached)}
                          {s.conversionFromPrev != null ? ` · ${s.conversionFromPrev}%` : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Диагноз" subtitle="Где теряются деньги" />
          {hasData && r.bottleneck ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-signal-bad/25 bg-signal-bad/[0.07] p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-bad" />
                <p className="text-sm text-content">{r.bottleneck.verdict}</p>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-line bg-ink-700/50 p-3.5">
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-signal-warn" />
                <p className="text-sm text-content-muted">
                  Узкое место: переход «{r.bottleneck.fromStage}» → «{r.bottleneck.toStage}». Сфокусируйте команду здесь.
                </p>
              </div>
            </div>
          ) : hasData ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Lightbulb className="h-6 w-6 text-signal-good" />
              <p className="text-sm text-content-muted">Явного узкого места не найдено — воронка работает ровно.</p>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-content-muted">Нет данных для диагноза за выбранный период.</p>
          )}
        </Card>
      </div>

      {tasks.connected && (
        <div className="mt-6">
          <Card>
            <CardHeader title="Задачи" subtitle="Открытые задачи amoCRM — снимок на текущий момент" />
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Просроченные задачи"
                value={formatNumber(tasks.overdue)}
                accent={tasks.overdue > 0 ? "bad" : "good"}
              />
              <StatCard label="Задачи на сегодня" value={formatNumber(tasks.dueToday)} accent="xray" />
              <StatCard
                label="Сделки без задач"
                value={formatNumber(tasks.leadsWithoutTasks)}
                hint="открытые сделки без единой задачи"
                accent={tasks.leadsWithoutTasks > 0 ? "bad" : "good"}
              />
            </div>
          </Card>
        </div>
      )}

      {data.managers.length > 0 && (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Менеджеры"
              subtitle={`${data.managers.length} чел. · по всем воронкам за период`}
              action={
                <Link href="/managers" className="text-sm font-medium text-xray hover:underline">
                  Все менеджеры
                </Link>
              }
            />
            <div className="overflow-hidden rounded-xl border border-line">
              {data.managers.slice(0, 5).map((m, i) => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between gap-4 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}
                >
                  <span className="truncate font-medium text-content">{m.name}</span>
                  <div className="flex items-center gap-5 text-sm">
                    <span className="nums text-content-muted">{formatNumber(m.leads)} сделок</span>
                    <span className="nums text-signal-good">{formatNumber(m.won)} выигр.</span>
                    <Badge tone={m.conversion >= 20 ? "good" : m.conversion >= 8 ? "warn" : "neutral"}>
                      {m.conversion}%
                    </Badge>
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

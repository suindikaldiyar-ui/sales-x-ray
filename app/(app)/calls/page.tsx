import Link from "next/link";
import {
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Filter,
  RefreshCw,
} from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getCallsData, fmtDuration } from "@/lib/analytics/calls";
import { getAiStatus } from "@/lib/ai/settings";
import { formatNumber } from "@/lib/utils";
import { fmtChatTime } from "@/lib/datetime";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { SyncButton } from "@/components/integrations/sync-button";
import { StatCard } from "@/components/app/stat-card";
import { CallRecordPlayer } from "@/components/calls/call-record-player";
import { CallAnalysisButton } from "@/components/calls/call-analysis-button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Звонки — Sales X-Ray" };

export default async function CallsPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const tenant = await requireTenant();
  const canManage = canManageIntegrations(tenant.role);
  const supabase = createClient();
  const data = await getCallsData(supabase, tenant.organization.id, {
    period: searchParams.period,
    from: searchParams.from,
    to: searchParams.to,
  });
  const ai = await getAiStatus(supabase, tenant.organization.id);

  if (!data.connected) {
    return (
      <>
        <PageHeader title="Звонки" description="Телефония Sipuni: входящие, исходящие, пропущенные." />
        <EmptyState
          icon={<Filter className="h-5 w-5" />}
          title="Подключите Sipuni"
          description="Сохраните ID пользователя и API-ключ Sipuni на странице «Интеграции», затем синхронизируйте звонки."
          action={canManage ? <Link href="/integrations"><Button>Перейти к интеграциям</Button></Link> : undefined}
        />
      </>
    );
  }

  if (!data.synced) {
    return (
      <>
        <PageHeader title="Звонки" description="Телефония Sipuni: входящие, исходящие, пропущенные." />
        <EmptyState
          icon={<RefreshCw className="h-5 w-5" />}
          title="Запустите синхронизацию"
          description="Загрузите статистику звонков из Sipuni."
          action={canManage ? <SyncButton endpoint="/api/sync/sipuni" label="Синхронизировать сейчас" /> : undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Звонки"
        description="Статистика телефонии Sipuni за период."
        action={
          canManage ? (
            <SyncButton size="sm" variant="primary" endpoint="/api/sync/sipuni" label="Синхронизировать сейчас" />
          ) : undefined
        }
      />

      <div className="mb-6">
        <FilterBar pipelines={[]} selectedPipelineId={null} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Всего звонков" value={formatNumber(data.total)} />
        <StatCard
          label="Входящие / исходящие"
          value={`${formatNumber(data.inbound)} / ${formatNumber(data.outbound)}`}
          accent="xray"
        />
        <StatCard
          label="Отвечено / пропущено"
          value={`${formatNumber(data.answered)} / ${formatNumber(data.missed)}`}
          accent={data.missed > data.answered ? "bad" : "good"}
        />
        <StatCard label="Ср. длительность" value={fmtDuration(data.avgDurationSec)} />
      </div>

      {data.total === 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-ink-700/40 p-8 text-center text-sm text-content-muted">
          За выбранный период звонков нет.
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* managers */}
          <Card className="lg:col-span-1">
            <CardHeader title="Менеджеры" subtitle="Принято / пропущено" />
            <div className="space-y-1">
              {data.managers.map((m) => (
                <div key={m.name} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2">
                  <span className="min-w-0 truncate text-sm font-medium text-content">{m.name}</span>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="nums text-signal-good" title="Отвечено">{formatNumber(m.answered)}</span>
                    <span className="nums text-signal-bad" title="Пропущено">{formatNumber(m.missed)}</span>
                    <span className="nums text-content-faint" title="Ср. длительность">{fmtDuration(m.avgDurationSec)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* calls list */}
          <Card className="overflow-x-auto p-0 lg:col-span-2">
            <CardHeader title="Звонки" subtitle="Последние за период" className="px-5 pt-5" />
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs font-medium uppercase tracking-wider text-content-faint">
                  <th className="px-5 py-2.5">Время</th>
                  <th className="px-3 py-2.5">Номер</th>
                  <th className="px-3 py-2.5">Менеджер</th>
                  <th className="px-3 py-2.5 text-right">Длит.</th>
                  <th className="px-3 py-2.5 text-right">Статус</th>
                  <th className="px-5 py-2.5 text-right">Запись</th>
                </tr>
              </thead>
              <tbody>
                {data.calls.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2">
                        {c.direction === "in" ? (
                          <PhoneIncoming className="h-3.5 w-3.5 text-signal-info" />
                        ) : c.direction === "out" ? (
                          <PhoneOutgoing className="h-3.5 w-3.5 text-content-muted" />
                        ) : (
                          <PhoneCall className="h-3.5 w-3.5 text-content-faint" />
                        )}
                        <span className="nums text-content-muted">{fmtChatTime(c.startedAt)}</span>
                      </span>
                    </td>
                    <td className="nums px-3 py-2.5 text-content">{c.clientPhone ?? "—"}</td>
                    <td className="px-3 py-2.5 text-content-muted">{c.managerName ?? "—"}</td>
                    <td className="nums px-3 py-2.5 text-right text-content-muted">{fmtDuration(c.durationSec)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.answered ? (
                        <Badge tone="good">отвечен</Badge>
                      ) : (
                        <Badge tone="bad">
                          <PhoneMissed className="h-3 w-3" /> пропущен
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {c.hasRecord ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <CallRecordPlayer callId={c.id} />
                          <CallAnalysisButton
                            callId={c.id}
                            hasAnalysis={c.hasAnalysis}
                            aiReady={ai.ready}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}

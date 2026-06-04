import Link from "next/link";
import { UserSquare, RefreshCw, Filter } from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getReportData } from "@/lib/analytics/report";
import { fmtMoney } from "@/lib/analytics/funnel";
import { formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { SyncButton } from "@/components/integrations/sync-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Менеджеры — Sales X-Ray" };

export default async function ManagersPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const tenant = await requireTenant();
  const canManage = canManageIntegrations(tenant.role);
  const supabase = createClient();
  const data = await getReportData(supabase, tenant.organization.id, {
    period: searchParams.period,
  });

  if (!data.connected) {
    return (
      <>
        <PageHeader title="Менеджеры" description="Эффективность менеджеров по сделкам amoCRM." />
        <EmptyState
          icon={<Filter className="h-5 w-5" />}
          title="Подключите amoCRM"
          description="Статистика по менеджерам строится из ваших сделок amoCRM."
          action={canManage ? <Link href="/integrations"><Button>Перейти к интеграциям</Button></Link> : undefined}
        />
      </>
    );
  }

  if (!data.synced) {
    return (
      <>
        <PageHeader title="Менеджеры" description="Эффективность менеджеров по сделкам amoCRM." />
        <EmptyState
          icon={<RefreshCw className="h-5 w-5" />}
          title="Запустите синхронизацию"
          description="Загрузите сделки и менеджеров из amoCRM."
          action={canManage ? <SyncButton /> : undefined}
        />
      </>
    );
  }

  const managers = data.managers;

  return (
    <>
      <PageHeader
        title="Менеджеры"
        description={`Эффективность по ${formatNumber(data.totalLeadsInPeriod)} сделкам · ${managers.length} ${managers.length === 1 ? "менеджер" : "менеджеров"}`}
      />

      <div className="mb-6">
        <FilterBar period={data.period} pipelines={[]} selectedPipelineId={null} />
      </div>

      {managers.length === 0 ? (
        <div className="rounded-2xl border border-line bg-ink-700/40 p-8 text-center text-sm text-content-muted">
          За выбранный период нет сделок с ответственными.
        </div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-content-faint">
                <th className="px-5 py-3">Менеджер</th>
                <th className="px-3 py-3 text-right">Сделок</th>
                <th className="px-3 py-3 text-right">Выиграно</th>
                <th className="px-3 py-3 text-right">Потеряно</th>
                <th className="px-3 py-3 text-right">В работе</th>
                <th className="px-3 py-3 text-right">Конверсия</th>
                <th className="px-5 py-3 text-right">Сумма выигранных</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} email={m.name} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium text-content">{m.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.topStages.map((s) => (
                            <span
                              key={s.name}
                              className="rounded-md border border-line bg-ink-700 px-1.5 py-0.5 text-[11px] text-content-faint"
                              title={`${s.name}: ${s.count}`}
                            >
                              {s.name}: {formatNumber(s.count)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="nums px-3 py-3 text-right font-medium text-content">
                    {formatNumber(m.leads)}
                  </td>
                  <td className="nums px-3 py-3 text-right text-signal-good">
                    {formatNumber(m.won)}
                  </td>
                  <td className="nums px-3 py-3 text-right text-signal-bad">
                    {formatNumber(m.lost)}
                  </td>
                  <td className="nums px-3 py-3 text-right text-content-muted">
                    {formatNumber(m.open)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Badge tone={m.conversion >= 20 ? "good" : m.conversion >= 8 ? "warn" : "neutral"}>
                      {m.conversion}%
                    </Badge>
                  </td>
                  <td className="nums px-5 py-3 text-right text-content">
                    {fmtMoney(m.wonValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

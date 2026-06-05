import Link from "next/link";
import {
  MessagesSquare,
  RefreshCw,
  Filter,
  Inbox,
  Clock,
  UserPlus,
  Webhook,
  ChevronRight,
} from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getConversationsData, type ConvFeedItem } from "@/lib/analytics/conversations";
import { getAiStatus } from "@/lib/ai/settings";
import { getCachedAnalyses, type Interest } from "@/lib/ai/analyze";
import { AnalyzeBatchButton } from "@/components/ai/analyze-batch-button";
import { formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { SyncButton } from "@/components/integrations/sync-button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/app/stat-card";

export const metadata = { title: "Переписка — Sales X-Ray" };

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ч`;
  return `${Math.round(hrs / 24)} дн`;
}

const INTEREST_BADGE: Record<Interest, { label: string; tone: "good" | "warn" | "bad" }> = {
  high: { label: "интерес ↑", tone: "good" },
  medium: { label: "интерес ~", tone: "warn" },
  low: { label: "интерес ↓", tone: "bad" },
  cold: { label: "остыл", tone: "bad" },
};

function ConvRow({ c, interest }: { c: ConvFeedItem; interest?: Interest }) {
  return (
    <Link
      href={`/conversations/${c.id}`}
      className="flex items-center gap-3 border-t border-line px-4 py-3 transition-colors first:border-0 hover:bg-ink-700/50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-ink-600 text-content-muted">
        <MessagesSquare className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-content">
            {c.contactName ?? c.contactHandle ?? "Без имени"}
          </p>
          {c.transport && <Badge tone="neutral">{c.transport}</Badge>}
          {c.unanswered && <Badge tone="bad">не отвечено</Badge>}
          {interest && <Badge tone={INTEREST_BADGE[interest].tone}>{INTEREST_BADGE[interest].label}</Badge>}
        </div>
        <p className="mt-0.5 truncate text-sm text-content-faint">
          {c.lastMessageInbound ? "← " : "→ "}
          {c.lastMessageText ?? "—"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs text-content-faint">{timeAgo(c.lastMessageAt)}</span>
        {c.managerName && (
          <span className="max-w-[8rem] truncate text-xs text-content-faint">{c.managerName}</span>
        )}
        <ChevronRight className="h-4 w-4 text-content-faint" />
      </div>
    </Link>
  );
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const tenant = await requireTenant();
  const canManage = canManageIntegrations(tenant.role);
  const supabase = createClient();
  const data = await getConversationsData(supabase, tenant.organization.id, {
    period: searchParams.period,
  });
  const ai = await getAiStatus(supabase, tenant.organization.id);
  const analyses = await getCachedAnalyses(
    supabase,
    tenant.organization.id,
    data.feed.map((c) => c.id),
  );

  if (!data.connected) {
    return (
      <>
        <PageHeader title="Переписка" description="Диалоги менеджеров с клиентами из Wazzup." />
        <EmptyState
          icon={<Filter className="h-5 w-5" />}
          title="Подключите Wazzup"
          description="Сохраните API-ключ Wazzup на странице «Интеграции», чтобы синхронизировать каналы и менеджеров."
          action={canManage ? <Link href="/integrations"><Button>Перейти к интеграциям</Button></Link> : undefined}
        />
      </>
    );
  }

  if (!data.synced) {
    return (
      <>
        <PageHeader title="Переписка" description="Диалоги менеджеров с клиентами из Wazzup." />
        <EmptyState
          icon={<RefreshCw className="h-5 w-5" />}
          title="Запустите синхронизацию"
          description="Загрузите каналы и менеджеров из Wazzup."
          action={canManage ? <SyncButton endpoint="/api/sync/wazzup" label="Синхронизировать каналы" /> : undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Переписка"
        description={`Каналы Wazzup: ${data.channels.map((c) => c.transport ?? c.name).filter(Boolean).join(", ") || "—"}`}
        action={
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-1.5">
              {data.channels.map((c, i) => (
                <Badge key={i} tone="xray">
                  {c.transport ?? c.name ?? "канал"}
                </Badge>
              ))}
            </div>
            {ai.ready && canManage && data.hasMessages && <AnalyzeBatchButton />}
          </div>
        }
      />

      <div className="mb-6">
        <FilterBar period={data.period} pipelines={[]} selectedPipelineId={null} />
      </div>

      {/* Honest state: history requires webhooks (next step). */}
      {!data.hasMessages && (
        <div className="mb-6 flex flex-col items-start gap-3 rounded-2xl border border-xray/20 bg-xray/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-xray/30 bg-xray/10 text-xray">
              <Webhook className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-content">
                История переписки появится после подключения вебхуков Wazzup
              </p>
              <p className="text-sm text-content-muted">
                Wazzup API v3 не отдаёт историю сообщений по REST — диалоги
                приходят только через вебхуки. Это следующий шаг (после деплоя).
                Каналы и менеджеры уже синхронизированы.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* analytics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Диалогов за период" value={formatNumber(data.dialogs)} placeholder={!data.hasMessages} />
        <StatCard label="Новых лидов написали" value={formatNumber(data.newLeads)} accent="xray" placeholder={!data.hasMessages} />
        <StatCard label="Не отвечено" value={formatNumber(data.unansweredCount)} accent="bad" placeholder={!data.hasMessages} />
        <StatCard
          label="Ср. время ответа"
          value={data.avgFirstResponseMin != null ? `${data.avgFirstResponseMin} мин` : "—"}
          placeholder={!data.hasMessages}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* feed */}
        <Card className="p-0 lg:col-span-2">
          <CardHeader title="Диалоги" subtitle="Последняя активность" className="px-5 pt-5" />
          {data.feed.length === 0 ? (
            <div className="px-5 pb-8">
              <EmptyState
                icon={<MessagesSquare className="h-5 w-5" />}
                title="Диалогов пока нет"
                description="Появятся здесь после подключения вебхуков Wazzup."
                className="py-10"
              />
            </div>
          ) : (
            <div className="pb-2">
              {data.feed.map((c) => (
                <ConvRow key={c.id} c={c} interest={analyses.get(c.id)?.interest} />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {/* unanswered */}
          <Card>
            <CardHeader
              title="Неотвеченные"
              subtitle="Клиент написал, менеджер молчит"
              action={<Badge tone={data.unansweredCount ? "bad" : "neutral"}>{data.unansweredCount}</Badge>}
            />
            {data.unanswered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Inbox className="h-5 w-5 text-content-faint" />
                <p className="text-sm text-content-muted">Нет неотвеченных диалогов.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {data.unanswered.slice(0, 8).map((c) => (
                  <Link
                    key={c.id}
                    href={`/conversations/${c.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-ink-700"
                  >
                    <span className="truncate text-content">{c.contactName ?? c.contactHandle ?? "—"}</span>
                    <span className="shrink-0 text-xs text-content-faint">{timeAgo(c.lastMessageAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* managers */}
          <Card>
            <CardHeader title="Менеджеры в переписке" subtitle="Диалоги и скорость ответа" />
            {data.managers.length === 0 ? (
              <p className="py-6 text-center text-sm text-content-muted">Данных пока нет.</p>
            ) : (
              <div className="space-y-1">
                {data.managers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2">
                    <span className="truncate text-sm font-medium text-content">{m.name}</span>
                    <div className="flex items-center gap-3 text-xs text-content-faint">
                      <span className="nums flex items-center gap-1">
                        <MessagesSquare className="h-3 w-3" />
                        {formatNumber(m.dialogs)}
                      </span>
                      {m.avgFirstResponseMin != null && (
                        <span className="nums flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {m.avgFirstResponseMin}м
                        </span>
                      )}
                      {m.unanswered > 0 && <Badge tone="bad">{m.unanswered}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

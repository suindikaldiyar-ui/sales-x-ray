import { FileBarChart, Sparkles, History } from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getAiStatus } from "@/lib/ai/settings";
import { getReportHistory } from "@/lib/ai/report";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { AiReportGenerator } from "@/components/ai/ai-report-generator";
import { MarkdownLite } from "@/components/ai/markdown-lite";
import { PERIOD_PRESETS } from "@/lib/period-range";

export const metadata = { title: "Отчёты — Sales X-Ray" };

function periodLabel(period: string) {
  if (period?.startsWith("custom_")) {
    const [, f, t] = period.split("_");
    return f && t ? `${f} — ${t}` : "Произвольный период";
  }
  return PERIOD_PRESETS.find((p) => p.key === period)?.label ?? period;
}

export default async function ReportsPage() {
  const tenant = await requireTenant();
  const canManage = canManageIntegrations(tenant.role);
  const supabase = createClient();

  const ai = await getAiStatus(supabase, tenant.organization.id);
  const history = await getReportHistory(supabase, tenant.organization.id);

  return (
    <>
      <PageHeader
        title="Отчёты"
        description="AI-отчёт по продажам: где теряются сделки, слабые менеджеры и рекомендации."
        action={
          <Badge tone={ai.ready ? "xray" : "neutral"}>
            <Sparkles className="h-3.5 w-3.5" />
            {ai.ready ? "Gemini готов" : "AI выключен"}
          </Badge>
        }
      />

      <AiReportGenerator aiReady={ai.ready} canGenerate={canManage} />

      <div className="mt-6">
        <Card>
          <CardHeader
            title="История отчётов"
            subtitle="Ранее сгенерированные AI-отчёты"
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-ink-700 text-content-muted">
                <History className="h-4 w-4" />
              </span>
            }
          />
          {history.length === 0 ? (
            <EmptyState
              icon={<FileBarChart className="h-5 w-5" />}
              title="Отчётов пока нет"
              description="Сгенерируйте первый AI-отчёт за период выше."
              className="py-10"
            />
          ) : (
            <div className="space-y-3">
              {history.map((h) => (
                <details
                  key={h.id}
                  className="group rounded-xl border border-line bg-ink-700/40 p-4 open:bg-ink-700/60"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 font-medium text-content">
                      <Sparkles className="h-3.5 w-3.5 text-xray" />
                      {h.title}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-content-faint">
                      <Badge tone="neutral">{periodLabel(h.period)}</Badge>
                      {new Date(h.createdAt).toLocaleDateString("ru-RU")}
                    </span>
                  </summary>
                  <div className="mt-3 border-t border-line pt-3">
                    <MarkdownLite content={h.content} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

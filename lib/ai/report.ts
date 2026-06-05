import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callGemini } from "./gemini";
import { requireGeminiKey } from "./settings";
import { getReportData } from "@/lib/analytics/report";
import { getConversationsData } from "@/lib/analytics/conversations";
import { fmtMoney } from "@/lib/analytics/funnel";
import { resolveRange, rangeToken, type RangeParams } from "@/lib/period-range";

export interface AiReport {
  period: string;
  periodLabel: string;
  title: string;
  content: string;
  model: string | null;
  createdAt: string;
  reportDate: string;
}

const SYSTEM = `Ты — коммерческий директор. По сухим цифрам отдела продаж ты пишешь короткий, честный и конкретный разбор для собственника бизнеса. Пиши на русском, по-деловому, опирайся на цифры. Без воды и общих фраз.`;

function buildBrief(
  report: Awaited<ReturnType<typeof getReportData>>,
  conv: Awaited<ReturnType<typeof getConversationsData>>,
  label: string,
): string {
  const r = report.report;
  const lines: string[] = [];
  lines.push(`Период: ${label}. Воронка: «${report.selectedPipelineName ?? "—"}».`);
  if (r) {
    lines.push(
      `Сделок: ${r.totalLeads}, выиграно: ${r.wonCount} (${r.overallConversion}%), потеряно: ${r.lostCount}. ` +
        `Сумма выигранных: ${fmtMoney(r.wonValue)}, упущено: ${fmtMoney(r.lostValue)}.`,
    );
    lines.push(
      "Воронка по этапам (сейчас на этапе → дошло когортно, конверсия к предыдущему):",
    );
    for (const s of r.funnel) {
      lines.push(
        `  - ${s.name}: сейчас ${s.current}, дошло ${s.reached}` +
          (s.conversionFromPrev != null ? `, конв. ${s.conversionFromPrev}%` : "") +
          (s.lostFromPrev ? `, потеряно ${s.lostFromPrev}` : ""),
      );
    }
    if (r.bottleneck) lines.push(`Узкое место: ${r.bottleneck.verdict}`);
    for (const m of r.keyMetrics.filter((k) => k.available)) {
      lines.push(`Ключевая метрика — ${m.title}: ${m.conversion}% (${m.toCount}/${m.fromCount}). ${m.verdict}`);
    }
  }
  if (report.managers.length) {
    lines.push("Менеджеры (сделки / выиграно / конверсия / сумма):");
    for (const m of report.managers.slice(0, 12)) {
      lines.push(`  - ${m.name}: ${m.leads} / ${m.won} / ${m.conversion}% / ${fmtMoney(m.wonValue)}`);
    }
  }
  if (conv.synced) {
    lines.push(
      `Переписка: диалогов ${conv.dialogs}, новых лидов ${conv.newLeads}, ` +
        `НЕотвечено ${conv.unansweredCount}, среднее время ответа ${
          conv.avgFirstResponseMin != null ? conv.avgFirstResponseMin + " мин" : "—"
        }.`,
    );
    if (conv.managers.length) {
      lines.push("Менеджеры в переписке (диалоги / неотвечено / ср.ответ мин):");
      for (const m of conv.managers.slice(0, 10)) {
        lines.push(`  - ${m.name}: ${m.dialogs} / ${m.unanswered} / ${m.avgFirstResponseMin ?? "—"}`);
      }
    }
  }
  return lines.join("\n");
}

function buildPrompt(brief: string): string {
  return `Данные отдела продаж за период:

${brief}

Составь отчёт в формате markdown со структурой:

## Краткое резюме
3-4 предложения: что происходит с продажами за период, главный вывод.

## Где теряются продажи
Назови конкретные узкие места воронки и слабых менеджеров (с именами и цифрами), объясни ПОЧЕМУ теряются сделки.

## Рекомендации
3-5 конкретных, выполнимых пунктов (нумерованный список) — что сделать руководителю и менеджерам, чтобы поднять продажи.

Опирайся только на приведённые цифры. Будь конкретным.`;
}

/**
 * Generate (or reuse today's) AI sales report for the period and store it in
 * daily_reports (kind='ai_sales'). Cached per (org, period, date) — pass force
 * to regenerate.
 */
export async function generateAiReport(
  supabase: SupabaseClient,
  org: string,
  rangeParams: RangeParams,
  opts: { force?: boolean } = {},
): Promise<AiReport> {
  const range = resolveRange(rangeParams);
  const period = rangeToken(range); // unique per preset/custom window
  const label = range.label;
  const reportDate = new Date().toISOString().slice(0, 10);

  if (!opts.force) {
    const { data: cached } = await supabase
      .from("daily_reports")
      .select("title, content, model, created_at, report_date, period")
      .eq("organization_id", org)
      .eq("kind", "ai_sales")
      .eq("period", period)
      .eq("report_date", reportDate)
      .maybeSingle();
    if (cached?.content) {
      return {
        period,
        periodLabel: label,
        title: cached.title ?? `Отчёт за ${label}`,
        content: cached.content,
        model: cached.model ?? null,
        createdAt: cached.created_at,
        reportDate: cached.report_date,
      };
    }
  }

  const [report, conv] = await Promise.all([
    getReportData(supabase, org, rangeParams),
    getConversationsData(supabase, org, rangeParams),
  ]);

  const brief = buildBrief(report, conv, label);
  const { apiKey, model } = await requireGeminiKey(supabase, org);
  const content = await callGemini(apiKey, model, {
    system: SYSTEM,
    prompt: buildPrompt(brief),
    temperature: 0.4,
    label: `sales-report org=${org} period=${period}`,
  });

  const title = `AI-отчёт по продажам · ${label}`;
  const createdAt = new Date().toISOString();
  await supabase.from("daily_reports").upsert(
    {
      organization_id: org,
      kind: "ai_sales",
      period,
      report_date: reportDate,
      title,
      content,
      model,
      payload: { brief },
      created_at: createdAt,
    },
    { onConflict: "organization_id,kind,period,report_date" },
  );

  return { period, periodLabel: label, title, content, model, createdAt, reportDate };
}

export interface ReportHistoryItem {
  id: string;
  title: string;
  period: string;
  content: string;
  createdAt: string;
  reportDate: string;
}

export async function getReportHistory(
  supabase: SupabaseClient,
  org: string,
): Promise<ReportHistoryItem[]> {
  const { data } = await supabase
    .from("daily_reports")
    .select("id, title, period, content, created_at, report_date")
    .eq("organization_id", org)
    .eq("kind", "ai_sales")
    .order("created_at", { ascending: false })
    .limit(20);
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    title: r.title ?? "AI-отчёт",
    period: r.period ?? "",
    content: r.content ?? "",
    createdAt: r.created_at,
    reportDate: r.report_date,
  }));
}

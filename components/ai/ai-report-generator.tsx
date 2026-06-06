"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { PERIOD_PRESETS } from "@/lib/period-range";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarkdownLite } from "./markdown-lite";
import { fmtDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

interface ReportResult {
  title: string;
  content: string;
  periodLabel: string;
  createdAt: string;
}

export function AiReportGenerator({
  aiReady,
  canGenerate,
}: {
  aiReady: boolean;
  canGenerate: boolean;
}) {
  const [period, setPeriod] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const usingCustom = period === "custom";

  async function generate(force: boolean) {
    if (usingCustom && (!from || !to)) {
      setError("Укажите даты «с» и «по» для произвольного периода.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, from, to, force }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Не удалось сгенерировать отчёт.");
        return;
      }
      setReport(data.report);
    } catch {
      setError("Сеть недоступна.");
    } finally {
      setLoading(false);
    }
  }

  if (!aiReady) {
    return (
      <Card>
        <p className="text-sm text-content-muted">
          AI-отчёты выключены или не задан ключ Gemini.{" "}
          <Link href="/settings" className="text-xray hover:underline">Включить в Настройках</Link>.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-2">Период отчёта</p>
          <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line-strong bg-ink-700/60 p-1">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                disabled={loading}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  period === p.key ? "bg-ink-500 text-content" : "text-content-muted hover:text-content",
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setPeriod("custom")}
              disabled={loading}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                usingCustom ? "bg-ink-500 text-content" : "text-content-muted hover:text-content",
              )}
            >
              Свой
            </button>
          </div>
          {usingCustom && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-lg border border-line-strong bg-ink-800 px-2 text-xs text-content [color-scheme:dark] focus:border-xray/50 focus:outline-none"
              />
              <span className="text-content-faint">—</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-lg border border-line-strong bg-ink-800 px-2 text-xs text-content [color-scheme:dark] focus:border-xray/50 focus:outline-none"
              />
            </div>
          )}
        </div>
        {canGenerate ? (
          <div className="flex gap-2">
            <Button onClick={() => generate(false)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "Генерируем…" : "Сгенерировать AI-отчёт"}
            </Button>
            {report && (
              <Button variant="ghost" onClick={() => generate(true)} disabled={loading} title="Перегенерировать">
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-content-faint">Генерация доступна владельцу и РОПу.</p>
        )}
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-1.5 text-sm text-signal-bad">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {report && (
        <div className="mt-5 border-t border-line pt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-content">{report.title}</h3>
            <span className="text-xs text-content-faint">
              {fmtDateTime(report.createdAt)}
            </span>
          </div>
          <MarkdownLite content={report.content} />
        </div>
      )}
    </Card>
  );
}

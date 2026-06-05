"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { PERIODS } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarkdownLite } from "./markdown-lite";
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
  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate(force: boolean) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, force }),
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
          <div className="inline-flex rounded-xl border border-line-strong bg-ink-700/60 p-1">
            {PERIODS.map((p) => (
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
          </div>
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
              {new Date(report.createdAt).toLocaleString("ru-RU")}
            </span>
          </div>
          <MarkdownLite content={report.content} />
        </div>
      )}
    </Card>
  );
}

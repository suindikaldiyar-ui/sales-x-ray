"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, X, RefreshCw, Target, ShieldAlert, ThumbsUp, ThumbsDown } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CallAnalysis, Interest } from "@/lib/ai/call-analysis";

const INTEREST: Record<Interest, { label: string; tone: "good" | "warn" | "bad" }> = {
  high: { label: "Интерес высокий", tone: "good" },
  medium: { label: "Интерес средний", tone: "warn" },
  low: { label: "Интерес низкий", tone: "bad" },
  cold: { label: "Клиент остыл", tone: "bad" },
};

export function CallAnalysisButton({
  callId,
  hasAnalysis,
  aiReady,
}: {
  callId: string;
  hasAnalysis: boolean;
  aiReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [analysis, setAnalysis] = useState<CallAnalysis | null>(null);
  const [error, setError] = useState("");

  async function load(force: boolean) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/analyze-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, force }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Не удалось проанализировать звонок.");
        return;
      }
      setTranscript(data.transcript ?? "");
      setAnalysis(data.analysis);
    } catch {
      setError("Сеть недоступна.");
    } finally {
      setLoading(false);
    }
  }

  function onClick() {
    setOpen(true);
    if (!analysis) load(false);
  }

  if (!aiReady) {
    return (
      <span className="text-[11px] text-content-faint" title="Включите AI в Настройках">
        AI выкл.
      </span>
    );
  }

  return (
    <>
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-lg border border-xray/30 bg-xray/10 px-2 py-1 text-xs font-medium text-xray transition-colors hover:bg-xray/20"
        title="AI-анализ звонка"
      >
        <Sparkles className="h-3 w-3" />
        {hasAnalysis ? "AI-анализ" : "Анализировать"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-left">
          <div className="absolute inset-0 bg-ink-900/85 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="panel scroll-slim relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6 text-left">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-base font-semibold text-content">
                <Sparkles className="h-4 w-4 text-xray" /> AI-анализ звонка
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-content-muted hover:bg-ink-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 py-10 text-sm text-content-muted">
                <Loader2 className="h-4 w-4 animate-spin text-xray" />
                Транскрибируем запись и анализируем…
              </div>
            )}

            {error && (
              <p className="flex items-start gap-1.5 py-4 text-sm text-signal-bad">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}

            {!loading && analysis && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={INTEREST[analysis.interest].tone}>{INTEREST[analysis.interest].label}</Badge>
                </div>

                <Section icon={<Target className="h-3.5 w-3.5" />} title="Итог" text={analysis.summary} />
                <Section icon={<ShieldAlert className="h-3.5 w-3.5 text-signal-warn" />} title="Возражения" text={analysis.objections} />
                <Section icon={<ThumbsUp className="h-3.5 w-3.5 text-signal-good" />} title="Хорошо" text={analysis.did_well} />
                <Section icon={<ThumbsDown className="h-3.5 w-3.5 text-signal-bad" />} title="Плохо / упущено" text={analysis.did_poorly} />
                <Section title="Движение сделки" text={analysis.outcome} />

                <div className="rounded-xl border border-xray/25 bg-xray/[0.06] p-3.5">
                  <p className="eyebrow mb-1 text-xray/80">Рекомендация менеджеру</p>
                  <p className="text-sm text-content">{analysis.recommendation}</p>
                </div>

                {transcript && (
                  <details className="rounded-xl border border-line bg-ink-700/40 p-3.5">
                    <summary className="cursor-pointer text-sm font-medium text-content-muted">
                      Транскрипт разговора
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-content">{transcript}</p>
                  </details>
                )}

                <button
                  onClick={() => load(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-content-faint transition-colors hover:text-content"
                >
                  <RefreshCw className="h-3 w-3" /> Проанализировать заново
                </button>
              </div>
            )}

            {!aiReady && (
              <p className="text-sm text-content-muted">
                AI выключен. <Link href="/settings" className="text-xray hover:underline">Включить</Link>.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Section({ icon, title, text }: { icon?: React.ReactNode; title: string; text: string }) {
  if (!text || text === "—") return null;
  return (
    <div className="rounded-xl border border-line bg-ink-700/40 p-3.5">
      <p className="eyebrow mb-1 flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <p className="text-sm text-content">{text}</p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, RefreshCw, Target, ShieldCheck, Clock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConversationAnalysis, Interest, Objections } from "@/lib/ai/analyze";

const INTEREST: Record<Interest, { label: string; tone: "good" | "warn" | "bad" }> = {
  high: { label: "Интерес: высокий", tone: "good" },
  medium: { label: "Интерес: средний", tone: "warn" },
  low: { label: "Интерес: низкий", tone: "bad" },
  cold: { label: "Клиент остыл", tone: "bad" },
};
const OBJECTIONS: Record<Objections, { label: string; tone: "good" | "warn" | "bad" }> = {
  yes: { label: "Возражения отработаны", tone: "good" },
  partial: { label: "Возражения частично", tone: "warn" },
  no: { label: "Возражения не отработаны", tone: "bad" },
};

export function ConversationAnalysisPanel({
  conversationId,
  initial,
  aiReady,
}: {
  conversationId: string;
  initial: ConversationAnalysis | null;
  aiReady: boolean;
}) {
  const [result, setResult] = useState<ConversationAnalysis | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze(force: boolean) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/analyze-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, force }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Не удалось проанализировать.");
        return;
      }
      setResult(data.result);
    } catch {
      setError("Сеть недоступна.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-xray/30 bg-xray/10 text-xray">
            <Sparkles className="h-4 w-4" />
          </span>
          <h3 className="font-display text-base font-semibold text-content">AI-анализ диалога</h3>
        </div>
        {aiReady && (
          <Button size="sm" variant={result ? "ghost" : "primary"} onClick={() => analyze(Boolean(result))} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : result ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Анализ…" : result ? "Переанализировать" : "Анализировать"}
          </Button>
        )}
      </div>

      {!aiReady && (
        <p className="text-sm text-content-muted">
          AI-анализ выключен или не задан ключ Gemini.{" "}
          <Link href="/settings" className="text-xray hover:underline">Включить в Настройках</Link>.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-sm text-signal-bad">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {result ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={INTEREST[result.interest].tone}>{INTEREST[result.interest].label}</Badge>
            <Badge tone={result.closing ? "good" : "bad"}>
              <Target className="h-3 w-3" /> {result.closing ? "Closing: да" : "Closing: нет"}
            </Badge>
            <Badge tone={OBJECTIONS[result.objections].tone}>
              <ShieldCheck className="h-3 w-3" /> {OBJECTIONS[result.objections].label}
            </Badge>
            <Badge tone="neutral">
              <Clock className="h-3 w-3" /> {result.response_speed}
            </Badge>
          </div>
          <div className="rounded-xl border border-line bg-ink-700/40 p-3.5">
            <p className="eyebrow mb-1">Итог</p>
            <p className="text-sm text-content">{result.summary}</p>
          </div>
          <div className="rounded-xl border border-xray/25 bg-xray/[0.06] p-3.5">
            <p className="eyebrow mb-1 text-xray/80">Рекомендация менеджеру</p>
            <p className="text-sm text-content">{result.recommendation}</p>
          </div>
        </div>
      ) : (
        aiReady &&
        !loading &&
        !error && (
          <p className="text-sm text-content-muted">
            Нажмите «Анализировать», чтобы Gemini оценил интерес клиента, работу с
            возражениями и дал рекомендацию.
          </p>
        )
      )}
    </div>
  );
}

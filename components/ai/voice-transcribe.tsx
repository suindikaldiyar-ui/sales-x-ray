"use client";

import { useState } from "react";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";

/** "Расшифровать" button for a voice message — calls Gemini, caches result. */
export function VoiceTranscribe({
  messageId,
  initial,
  aiReady,
}: {
  messageId: string;
  initial: string | null;
  aiReady: boolean;
}) {
  const [transcript, setTranscript] = useState<string | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Не удалось расшифровать.");
        return;
      }
      setTranscript(data.transcript);
    } catch {
      setError("Сеть недоступна.");
    } finally {
      setLoading(false);
    }
  }

  if (transcript) {
    return (
      <p className="mt-1.5 rounded-lg border border-line bg-ink-800/60 px-2.5 py-1.5 text-xs text-content">
        <span className="mr-1 text-content-faint">📝</span>
        {transcript}
      </p>
    );
  }

  return (
    <div className="mt-1.5">
      {aiReady ? (
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-xray/30 bg-xray/10 px-2 py-1 text-xs font-medium text-xray transition-colors hover:bg-xray/20 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {loading ? "Расшифровка…" : "Расшифровать"}
        </button>
      ) : (
        <span className="text-[11px] text-content-faint">AI выключен — включите в Настройках</span>
      )}
      {error && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-signal-bad">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

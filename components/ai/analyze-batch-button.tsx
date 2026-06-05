"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Analyze recent unanswered dialogs in one bounded batch. */
export function AnalyzeBatchButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function run() {
    setState("running");
    setMessage("");
    try {
      const res = await fetch("/api/ai/analyze-batch", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? "Не удалось.");
        return;
      }
      setState("done");
      setMessage(data.message ?? `Проанализировано: ${data.analyzed}`);
      router.refresh();
    } catch {
      setState("error");
      setMessage("Сеть недоступна.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={run} disabled={state === "running"}>
        {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {state === "running" ? "AI-анализ…" : "Анализировать неотвеченные"}
      </Button>
      {state === "done" && (
        <span className="flex items-center gap-1 text-xs text-signal-good">
          <CheckCircle2 className="h-3 w-3" /> {message}
        </span>
      )}
      {state === "error" && (
        <span className="flex items-center gap-1 text-xs text-signal-bad">
          <AlertTriangle className="h-3 w-3" /> {message}
        </span>
      )}
    </div>
  );
}

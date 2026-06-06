"use client";

import { useState } from "react";
import { Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** «Отправить отчёт в Telegram сейчас» — manual trigger of the daily report. */
export function TelegramTestButton() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send() {
    setState("sending");
    setMessage("");
    try {
      const res = await fetch("/api/reports/telegram-test", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? "Не удалось отправить.");
        return;
      }
      setState("done");
      setMessage("Отчёт отправлен в Telegram");
    } catch {
      setState("error");
      setMessage("Сеть недоступна.");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button onClick={send} disabled={state === "sending"} variant="outline" size="sm">
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {state === "sending" ? "Отправляем…" : "Отправить отчёт в Telegram"}
      </Button>
      {state === "done" && (
        <span className="flex items-center gap-1 text-xs text-signal-good">
          <CheckCircle2 className="h-3.5 w-3.5" /> ✅ {message}
        </span>
      )}
      {state === "error" && (
        <span className="flex items-start gap-1 text-xs text-signal-bad">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> ❌ {message}
        </span>
      )}
    </div>
  );
}

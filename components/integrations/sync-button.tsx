"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle2, AlertTriangle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BatchResponse {
  ok: boolean;
  resumable?: boolean;
  error?: string;
  done?: boolean;
  phase?: "pipelines" | "leads" | "events" | "done";
  progress?: number;
  leadsSynced?: number;
  eventsProcessed?: number;
  windowDays?: number;
  message?: string;
}

const PHASE_LABEL: Record<string, string> = {
  pipelines: "Загрузка воронок…",
  leads: "Загрузка сделок…",
  events: "Анализ истории переходов…",
  done: "Готово",
};

const MAX_RESUMABLE_RETRIES = 8;
const MAX_ITERATIONS = 5000; // hard stop guard (tiny batches → many iterations)

/**
 * Drives the incremental amoCRM sync: kicks off a run, then repeatedly asks the
 * server to process the next batch until `done`, showing a live progress bar.
 * Resumable errors (rate limit / timeout) are retried automatically.
 */
export function SyncButton({
  label = "Синхронизировать",
  variant = "primary",
  size = "md",
  showFull = false,
  endpoint = "/api/sync/amocrm",
  className,
}: {
  label?: string;
  variant?: "primary" | "outline" | "secondary";
  size?: "sm" | "md" | "lg";
  showFull?: boolean;
  endpoint?: string;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [counts, setCounts] = useState<{ leads: number; events: number }>({ leads: 0, events: 0 });
  const [message, setMessage] = useState("");
  const running = useRef(false);

  async function postBatch(body: object): Promise<BatchResponse> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as BatchResponse;
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // Not resumable.
      return { ...data, ok: false, resumable: false };
    }
    return data;
  }

  function apply(data: BatchResponse) {
    if (typeof data.progress === "number") setProgress(data.progress);
    if (data.phase) setPhase(PHASE_LABEL[data.phase] ?? "");
    setCounts({ leads: data.leadsSynced ?? 0, events: data.eventsProcessed ?? 0 });
  }

  async function run(full: boolean) {
    if (running.current) return;
    running.current = true;
    setState("syncing");
    setProgress(0);
    setMessage("");
    setPhase(PHASE_LABEL.pipelines);

    let retries = 0;
    try {
      let data = await postBatch({ start: true, full });
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (!data.ok) {
          if (!data.resumable || retries >= MAX_RESUMABLE_RETRIES) {
            setState("error");
            setMessage(data.error ?? "Ошибка синхронизации.");
            return;
          }
          retries += 1;
          await new Promise((r) => setTimeout(r, 1500 * retries));
          data = await postBatch({ start: false });
          continue;
        }
        retries = 0;
        apply(data);
        if (data.done) {
          setState("done");
          setProgress(1);
          setMessage(
            data.message ??
              `Загружено ${data.leadsSynced ?? 0} сделок` +
                (data.windowDays ? ` за ${data.windowDays} дн.` : "") + ".",
          );
          router.refresh();
          return;
        }
        // Small pause between batches — keeps the amoCRM pacer happy.
        await new Promise((r) => setTimeout(r, 500));
        data = await postBatch({ start: false });
      }
      // Exhausted iterations without finishing.
      setState("error");
      setMessage("Синхронизация не завершилась. Попробуйте ещё раз — она продолжится с места остановки.");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Сеть недоступна.");
    } finally {
      running.current = false;
    }
  }

  const syncing = state === "syncing";
  const pct = Math.round(progress * 100);

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => run(false)} disabled={syncing} variant={variant} size={size}>
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? "Синхронизация…" : label}
        </Button>
        {showFull && (
          <Button onClick={() => run(true)} disabled={syncing} variant="ghost" size={size}>
            <History className="h-4 w-4" />
            Полная история (365 дн.)
          </Button>
        )}
      </div>

      {syncing && (
        <div className="w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-xray/50 to-xray transition-all duration-500"
              style={{ width: `${Math.max(5, pct)}%` }}
            />
          </div>
          <p className="mt-1.5 flex items-center justify-between text-xs text-content-faint">
            <span>{phase}</span>
            <span className="nums">
              {counts.leads > 0 ? `${counts.leads} сделок` : `${pct}%`}
            </span>
          </p>
        </div>
      )}

      {state === "done" && (
        <p className="flex items-center gap-1.5 text-xs text-signal-good">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {message}
        </p>
      )}
      {state === "error" && (
        <p className="flex items-start gap-1.5 text-xs text-signal-bad">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {message}
        </p>
      )}
    </div>
  );
}

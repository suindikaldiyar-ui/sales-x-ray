"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { PERIOD_PRESETS, resolveRange } from "@/lib/period-range";
import type { PipelineRef } from "@/lib/periods";
import { cn } from "@/lib/utils";

/**
 * Period selector (presets + custom date range) and pipeline picker. The period
 * is read from / written to the URL (`?period=…&from=…&to=…`) so every page
 * shares it. Range applies by lead creation date (created_at_src).
 */
export function FilterBar({
  pipelines,
  selectedPipelineId,
}: {
  pipelines: PipelineRef[];
  selectedPipelineId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const range = resolveRange({
    period: params.get("period"),
    from: params.get("from"),
    to: params.get("to"),
  });

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.fromParam ?? "");
  const [to, setTo] = useState(range.toParam ?? "");

  function push(next: URLSearchParams) {
    router.push(`${pathname}?${next.toString()}`);
  }
  function setPreset(key: string) {
    const n = new URLSearchParams(params.toString());
    n.set("period", key);
    n.delete("from");
    n.delete("to");
    setOpen(false);
    push(n);
  }
  function applyCustom() {
    if (!from || !to) return;
    const n = new URLSearchParams(params.toString());
    n.set("period", "custom");
    n.set("from", from);
    n.set("to", to);
    setOpen(false);
    push(n);
  }
  function setPipeline(v: string) {
    const n = new URLSearchParams(params.toString());
    n.set("pipeline", v);
    push(n);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* period selector */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-ink-700/60 px-3.5 py-2.5 text-sm font-medium text-content transition-colors hover:bg-ink-600"
        >
          <Calendar className="h-4 w-4 text-xray" />
          {range.label}
          <ChevronDown className={cn("h-4 w-4 text-content-faint transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border border-line-strong bg-ink-700 p-2 shadow-panel">
              {PERIOD_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    range.key === p.key
                      ? "bg-ink-600 text-content"
                      : "text-content-muted hover:bg-ink-600 hover:text-content",
                  )}
                >
                  {p.label}
                  {range.key === p.key && <Check className="h-4 w-4 text-xray" />}
                </button>
              ))}

              <div className="rule mx-1 my-1.5" />
              <p className="px-2.5 pb-1.5 text-xs text-content-faint">Произвольный период</p>
              <div className="flex items-center gap-2 px-2.5">
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 flex-1 rounded-lg border border-line-strong bg-ink-800 px-2 text-xs text-content [color-scheme:dark] focus:border-xray/50 focus:outline-none"
                />
                <span className="text-content-faint">—</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 flex-1 rounded-lg border border-line-strong bg-ink-800 px-2 text-xs text-content [color-scheme:dark] focus:border-xray/50 focus:outline-none"
                />
              </div>
              <button
                onClick={applyCustom}
                disabled={!from || !to}
                className="mt-2 w-full rounded-lg bg-xray px-3 py-2 text-sm font-medium text-ink-900 transition-colors hover:bg-xray-soft disabled:opacity-40"
              >
                Применить
              </button>
            </div>
          </>
        )}
      </div>

      {/* pipeline picker */}
      {pipelines.length > 0 && (
        <div className="relative inline-flex items-center">
          <select
            value={selectedPipelineId ?? undefined}
            onChange={(e) => setPipeline(e.target.value)}
            className="h-10 appearance-none rounded-xl border border-line-strong bg-ink-700/60 pl-3.5 pr-9 text-sm font-medium text-content focus:border-xray/50 focus:outline-none"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.leadCount})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-content-faint" />
        </div>
      )}
    </div>
  );
}

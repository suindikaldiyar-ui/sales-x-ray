"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { PERIODS, type PeriodKey, type PipelineRef } from "@/lib/periods";
import { cn } from "@/lib/utils";

/** Period segmented control + pipeline picker that drive the URL searchParams. */
export function FilterBar({
  period,
  pipelines,
  selectedPipelineId,
}: {
  period: PeriodKey;
  pipelines: PipelineRef[];
  selectedPipelineId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* period segmented control */}
      <div className="inline-flex rounded-xl border border-line-strong bg-ink-700/60 p-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setParam("period", p.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              period === p.key
                ? "bg-ink-500 text-content shadow-sm"
                : "text-content-muted hover:text-content",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* pipeline picker */}
      {pipelines.length > 0 && (
        <div className="relative inline-flex items-center">
          <select
            value={selectedPipelineId ?? undefined}
            onChange={(e) => setParam("pipeline", e.target.value)}
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

import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  trend,
  placeholder = false,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: { value: string; up: boolean };
  placeholder?: boolean;
  accent?: "xray" | "good" | "bad";
}) {
  const accentColor =
    accent === "xray"
      ? "text-xray"
      : accent === "good"
        ? "text-signal-good"
        : accent === "bad"
          ? "text-signal-bad"
          : "text-content";

  return (
    <div className="panel p-5">
      <p className="text-sm text-content-muted">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p
          className={cn(
            "nums font-display text-3xl font-bold tracking-tight",
            placeholder ? "text-content-faint" : accentColor,
          )}
        >
          {placeholder ? "—" : value}
        </p>
        {trend && !placeholder && (
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-1 text-xs font-medium",
              trend.up ? "text-signal-good" : "text-signal-bad",
            )}
          >
            {trend.up ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {trend.value}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-content-faint">{hint}</p>}
    </div>
  );
}

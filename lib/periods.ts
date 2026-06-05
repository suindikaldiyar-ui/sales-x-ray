// Client-safe period constants shared by the filter UI and the report layer.

export const PERIODS = [
  { key: "7d", label: "7 дней", days: 7 },
  { key: "30d", label: "30 дней", days: 30 },
  { key: "90d", label: "90 дней", days: 90 },
  { key: "all", label: "Всё время", days: null },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

/** Client-safe pipeline reference for the funnel filter. */
export interface PipelineRef {
  id: number;
  name: string;
  leadCount: number;
}

export function normalizePeriod(raw: string | undefined | null): PeriodKey {
  const found = PERIODS.find((p) => p.key === raw);
  return found ? found.key : "30d";
}

/** Lower bound (unix seconds) for a period, or undefined for "all". */
export function periodStart(
  key: PeriodKey,
  now: number = Math.floor(Date.now() / 1000),
): number | undefined {
  const p = PERIODS.find((x) => x.key === key);
  if (!p || p.days == null) return undefined;
  return now - p.days * 86400;
}

/** Number of days for a period, or null for "all" — passed to the SQL RPCs. */
export function periodDays(key: PeriodKey): number | null {
  const p = PERIODS.find((x) => x.key === key);
  return p?.days ?? null;
}

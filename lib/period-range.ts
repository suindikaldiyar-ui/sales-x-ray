// Client-safe period model: presets + custom date range. Everything resolves to
// a {from, to} window applied by date of LEAD CREATION (created_at_src). Used by
// the filter UI (client) and the analytics layer (server).

export const PERIOD_PRESETS = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
  { key: "all", label: "Всё время" },
] as const;

export type PresetKey = (typeof PERIOD_PRESETS)[number]["key"];

export interface RangeParams {
  period?: string | null;
  from?: string | null; // YYYY-MM-DD (custom)
  to?: string | null; // YYYY-MM-DD (custom)
}

export interface ResolvedRange {
  /** "today" | … | "all" | "custom" */
  key: string;
  label: string;
  from: Date | null;
  to: Date | null;
  /** Echo of the custom date params (to repopulate the date inputs). */
  fromParam: string | null;
  toParam: string | null;
}

// Day boundaries are computed in Almaty time (UTC+5, no DST) so "Сегодня"/
// "Вчера" match the real calendar day in Kazakhstan, then expressed as UTC
// instants for the timestamptz filter.
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Start of the Almaty day containing instant `d`, as a UTC Date. */
function startOfAlmatyDay(d: Date): Date {
  const shifted = new Date(d.getTime() + ALMATY_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - ALMATY_OFFSET_MS);
}

/** Almaty calendar date "YYYY-MM-DD" → UTC instant of its 00:00. */
function almatyDateStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - ALMATY_OFFSET_MS);
}

function rolling(days: number, label: string, now: Date): ResolvedRange {
  return {
    key: `${days}d`,
    label,
    from: new Date(now.getTime() - days * 86400000),
    to: null,
    fromParam: null,
    toParam: null,
  };
}

/** Resolve URL params to a concrete window. Defaults to 30 days. */
export function resolveRange(p: RangeParams, now: Date = new Date()): ResolvedRange {
  const period = p.period ?? "30d";

  if (period === "custom" && p.from && p.to) {
    const from = almatyDateStart(p.from);
    const to = new Date(almatyDateStart(p.to).getTime() + 86400000 - 1);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { key: "custom", label: `${p.from} — ${p.to}`, from, to, fromParam: p.from, toParam: p.to };
    }
  }

  switch (period) {
    case "today":
      return { key: "today", label: "Сегодня", from: startOfAlmatyDay(now), to: null, fromParam: null, toParam: null };
    case "yesterday": {
      const todayStart = startOfAlmatyDay(now);
      const from = new Date(todayStart.getTime() - 86400000);
      const to = new Date(todayStart.getTime() - 1);
      return { key: "yesterday", label: "Вчера", from, to, fromParam: null, toParam: null };
    }
    case "7d":
      return rolling(7, "7 дней", now);
    case "90d":
      return rolling(90, "90 дней", now);
    case "all":
      return { key: "all", label: "Всё время", from: null, to: null, fromParam: null, toParam: null };
    case "30d":
    default:
      return rolling(30, "30 дней", now);
  }
}

/** A stable cache token for a range (used as the AI report `period` key). */
export function rangeToken(r: ResolvedRange): string {
  return r.key === "custom" ? `custom_${r.fromParam}_${r.toParam}` : r.key;
}

// All absolute date/time DISPLAY in the app is formatted in Almaty time
// (Asia/Almaty, UTC+5). Storage stays UTC (timestamptz) — this only affects how
// instants are rendered. Relative "N минут назад" helpers are timezone-agnostic
// (epoch diffs) and don't use these.

export const APP_TZ = "Asia/Almaty";

function fmt(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: APP_TZ, ...options }).format(d);
}

/** "09:10" */
export function fmtTime(value: string | number | Date | null | undefined): string {
  return fmt(value, { hour: "2-digit", minute: "2-digit" });
}

/** "06.06, 09:10" — compact for chat bubbles. */
export function fmtChatTime(value: string | number | Date | null | undefined): string {
  return fmt(value, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "6 июня 2026" */
export function fmtDate(value: string | number | Date | null | undefined): string {
  return fmt(value, { day: "numeric", month: "long", year: "numeric" });
}

/** "06.06.2026" */
export function fmtShortDate(value: string | number | Date | null | undefined): string {
  return fmt(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "6 июн. 2026, 09:10" */
export function fmtDateTime(value: string | number | Date | null | undefined): string {
  return fmt(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Client-safe helpers for rendering Wazzup messages of any type.

/** Wazzup message types that carry no text body — shown as a typed chip. */
const TYPE_LABELS: Record<string, string> = {
  missing_call: "📞 Пропущенный звонок",
  missed_call: "📞 Пропущенный звонок",
  call: "📞 Звонок",
  image: "🖼 Фото",
  picture: "🖼 Фото",
  video: "🎥 Видео",
  audio: "🎤 Голосовое",
  voice: "🎤 Голосовое",
  ptt: "🎤 Голосовое",
  document: "📎 Файл",
  file: "📎 Файл",
  geo: "📍 Геолокация",
  location: "📍 Геолокация",
  contact: "👤 Контакт",
  vcard: "👤 Контакт",
  sticker: "🌟 Стикер",
};

/**
 * Human preview for a message: the text when present, otherwise a friendly
 * label based on the Wazzup message `type` (so non-text messages never show
 * an empty "—").
 */
export function messagePreview(
  body: string | null | undefined,
  type: string | null | undefined,
): string {
  if (body && body.trim()) return body;
  const t = (type ?? "").toLowerCase();
  if (t === "text" || t === "") return body?.trim() ? body : "—";
  return TYPE_LABELS[t] ?? `[вложение: ${type}]`;
}

/** True when the message has no text body (render the preview as muted/italic). */
export function isAttachment(
  body: string | null | undefined,
  type: string | null | undefined,
): boolean {
  if (body && body.trim()) return false;
  const t = (type ?? "").toLowerCase();
  return t !== "text" && t !== "";
}

import { Fragment } from "react";

/** Render inline **bold** segments. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-content">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

/**
 * Minimal, dependency-free markdown renderer for the AI report output
 * (headings, bullet/numbered lists, paragraphs, bold). Safe — text only.
 */
export function MarkdownLite({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag
        key={blocks.length}
        className={`my-2 space-y-1.5 pl-5 text-sm text-content-muted ${list.ordered ? "list-decimal" : "list-disc"}`}
      >
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^###\s+/.test(line)) {
      flush();
      blocks.push(
        <h4 key={blocks.length} className="mt-4 font-display text-sm font-semibold text-content">
          {inline(line.replace(/^###\s+/, ""))}
        </h4>,
      );
    } else if (/^##\s+/.test(line)) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="mt-5 font-display text-base font-semibold text-content">
          {inline(line.replace(/^##\s+/, ""))}
        </h3>,
      );
    } else if (/^#\s+/.test(line)) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="mt-5 font-display text-lg font-bold text-content">
          {inline(line.replace(/^#\s+/, ""))}
        </h3>,
      );
    } else if (/^\d+\.\s+/.test(line)) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(line.replace(/^\d+\.\s+/, ""));
    } else if (/^[-*]\s+/.test(line)) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flush();
      blocks.push(
        <p key={blocks.length} className="my-2 text-sm leading-relaxed text-content-muted">
          {inline(line)}
        </p>,
      );
    }
  }
  flush();

  return <div className="space-y-0.5">{blocks}</div>;
}

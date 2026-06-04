import { cn, ROLE_LABELS } from "@/lib/utils";
import type { MembershipRole } from "@/lib/types/db";

type Tone = "neutral" | "xray" | "good" | "warn" | "bad" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-ink-500 text-content-muted border-line-strong",
  xray: "bg-xray/12 text-xray border-xray/25",
  good: "bg-signal-good/12 text-signal-good border-signal-good/25",
  warn: "bg-signal-warn/12 text-signal-warn border-signal-warn/25",
  bad: "bg-signal-bad/12 text-signal-bad border-signal-bad/25",
  info: "bg-signal-info/12 text-signal-info border-signal-info/25",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const roleTone: Record<MembershipRole, Tone> = {
  OWNER: "xray",
  ROP: "info",
  MOP: "neutral",
};

export function RoleBadge({ role }: { role: MembershipRole }) {
  return <Badge tone={roleTone[role]}>{ROLE_LABELS[role]}</Badge>;
}

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        on ? "bg-signal-good shadow-[0_0_8px_2px_rgba(74,222,128,0.5)]" : "bg-content-faint",
      )}
    />
  );
}

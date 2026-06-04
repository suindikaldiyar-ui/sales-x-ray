import { cn } from "@/lib/utils";

/** The Sales X-Ray mark: a scan-line "crosshair" lozenge. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-xray/30 bg-ink-700",
        className,
      )}
    >
      <span className="absolute inset-0 bg-radial-glow opacity-80" />
      <svg viewBox="0 0 24 24" className="relative h-5 w-5 text-xray" fill="none">
        <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 14l2-4 2 3 1.5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-xray/30 to-transparent animate-scan" />
    </span>
  );
}

export function Logo({
  className,
  withText = true,
}: {
  className?: string;
  withText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {withText && (
        <span className="font-display text-[17px] font-bold tracking-tight text-content">
          Sales<span className="text-xray"> X-Ray</span>
        </span>
      )}
    </span>
  );
}

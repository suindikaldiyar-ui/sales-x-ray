import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "error";

const config: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "border-signal-info/25 bg-signal-info/10 text-signal-info", Icon: Info },
  success: { cls: "border-signal-good/25 bg-signal-good/10 text-signal-good", Icon: CheckCircle2 },
  error: { cls: "border-signal-bad/25 bg-signal-bad/10 text-signal-bad", Icon: AlertTriangle },
};

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const { cls, Icon } = config[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        cls,
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-content">{children}</div>
    </div>
  );
}

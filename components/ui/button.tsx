import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xray/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary:
    "bg-xray text-ink-900 hover:bg-xray-soft shadow-[0_8px_24px_-10px_rgba(94,234,212,0.6)] hover:shadow-[0_10px_30px_-8px_rgba(94,234,212,0.7)]",
  secondary:
    "bg-ink-500 text-content hover:bg-ink-400 border border-line-strong",
  outline:
    "border border-line-strong text-content hover:bg-ink-600 hover:border-xray/40",
  ghost: "text-content-muted hover:text-content hover:bg-ink-600",
  danger:
    "bg-signal-bad/15 text-signal-bad border border-signal-bad/30 hover:bg-signal-bad/25",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-7 text-[15px]",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

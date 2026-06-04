import { cn, initialsFrom } from "@/lib/utils";

export function Avatar({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string | null;
  email: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-ink-500 font-medium text-content-muted",
        sizes[size],
        className,
      )}
    >
      {initialsFrom(name, email)}
    </span>
  );
}

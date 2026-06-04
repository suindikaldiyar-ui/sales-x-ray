import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel p-5 sm:p-6", className)} {...props} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex items-start justify-between gap-4", className)}>
      <div>
        <h3 className="font-display text-base font-semibold text-content">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-sm text-content-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

import { cn } from "@/lib/utils";

function Block({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-ink-600/60", className)} />;
}

/** Loading placeholder shown (inside a Suspense boundary) only over the data
 * area, so the page header and filter bar stay interactive during a filter
 * change. */
export function ReportSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-5">
            <Block className="h-3 w-24" />
            <Block className="mt-3 h-7 w-20" />
          </div>
        ))}
      </div>
      <div className="panel p-6">
        <Block className="h-4 w-40" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Block key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ManagersSkeleton() {
  return (
    <div className="panel p-6">
      <Block className="h-4 w-40" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Block key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

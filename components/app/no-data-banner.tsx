import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

/**
 * Shown across analytics pages until a data source is connected. Communicates
 * the empty state honestly while pointing to the Integrations page.
 */
export function NoDataBanner({
  connected,
  canManage = true,
}: {
  connected: boolean;
  canManage?: boolean;
}) {
  if (connected) return null;
  return (
    <div className="mb-6 flex flex-col items-start gap-3 rounded-2xl border border-xray/20 bg-xray/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-xray/30 bg-xray/10 text-xray">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-content">
            Данные появятся после подключения amoCRM
          </p>
          <p className="text-sm text-content-muted">
            Сейчас показаны демонстрационные значения-заглушки.
          </p>
        </div>
      </div>
      {canManage && (
        <Link
          href="/integrations"
          className="inline-flex items-center gap-1.5 rounded-lg border border-xray/30 bg-xray/10 px-3 py-2 text-sm font-medium text-xray transition-colors hover:bg-xray/20"
        >
          Подключить
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

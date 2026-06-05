"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { Webhook, Copy, Check, RefreshCw, Info } from "lucide-react";
import { setWazzupWebhookAction } from "@/lib/integrations/actions";
import type { IntegrationActionState } from "@/lib/integrations/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: IntegrationActionState = {};

/**
 * Renders the Wazzup webhook ingest setup: generate a per-org secret, then show
 * the exact URL to paste into Wazzup (secret travels in the `?s=` query). The
 * URL is built from the current origin so it is correct on prod and locally.
 */
export function WazzupWebhook({
  orgId,
  secret,
}: {
  orgId: string;
  secret: string | null;
}) {
  const [state, formAction] = useFormState(setWazzupWebhookAction, initial);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = secret
    ? `${origin}/api/webhooks/wazzup/${orgId}?s=${secret}`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-ink-700/40 p-4">
      <div className="flex items-center gap-2">
        <Webhook className="h-4 w-4 text-xray" />
        <p className="text-sm font-medium text-content">Приём переписки (вебхуки)</p>
      </div>

      <p className="flex items-start gap-2 text-xs text-content-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-faint" />
        Wazzup API не отдаёт историю по REST — входящие/исходящие сообщения
        приходят только вебхуками. Имена менеджеров берём из amoCRM и из поля
        автора сообщения.
      </p>

      {!secret ? (
        <form action={formAction}>
          {state.error && <Alert tone="error">{state.error}</Alert>}
          <SubmitButton size="sm" pendingLabel="Готовим…">
            <Webhook className="h-4 w-4" />
            Включить приём — получить URL
          </SubmitButton>
        </form>
      ) : (
        <>
          <div>
            <p className="mb-1 text-xs text-content-faint">
              Вставьте этот URL в Wazzup (поле webhooksUri):
            </p>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line-strong bg-ink-800 px-3 py-2 font-mono text-xs text-content" title={url}>
                {url || "…"}
              </code>
              <button
                onClick={copy}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs text-content-muted transition-colors hover:bg-ink-600 hover:text-content"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-signal-good" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Скопировано" : "Копировать"}
              </button>
            </div>
          </div>

          <form action={formAction}>
            {state.message && <Alert tone="success">{state.message}</Alert>}
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-xs text-content-faint transition-colors hover:text-content-muted"
            >
              <RefreshCw className="h-3 w-3" />
              Перегенерировать секрет
            </button>
          </form>
        </>
      )}
    </div>
  );
}

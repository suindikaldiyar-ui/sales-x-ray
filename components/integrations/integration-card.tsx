"use client";

import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import type { ProviderCatalogEntry } from "@/lib/integrations/catalog";
import type { IntegrationStatus } from "@/lib/types/db";
import { Badge, StatusDot } from "@/components/ui/badge";
import { disconnectIntegrationAction } from "@/lib/integrations/actions";
import { IntegrationForm } from "./integration-form";
import { SyncButton } from "./sync-button";
import { TestConnectionButton } from "./test-connection-button";
import { WazzupWebhook } from "./wazzup-webhook";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  CONNECTED: "Подключено",
  NOT_CONNECTED: "Не подключено",
  ERROR: "Ошибка",
};

function syncedAgo(iso: string | null): string {
  if (!iso) return "ещё не синхронизировано";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "обновлено только что";
  if (mins < 60) return `обновлено ${mins} мин назад`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `обновлено ${hrs} ч назад`;
  return `обновлено ${Math.round(hrs / 24)} дн назад`;
}

export function IntegrationCard({
  entry,
  status,
  storedKeys,
  lastSyncedAt = null,
  lastAutoSyncedAt = null,
  webhookOrgId,
  webhookSecret = null,
}: {
  entry: ProviderCatalogEntry;
  status: IntegrationStatus;
  storedKeys: string[];
  lastSyncedAt?: string | null;
  lastAutoSyncedAt?: string | null;
  webhookOrgId?: string;
  webhookSecret?: string | null;
}) {
  const connected = status === "CONNECTED";
  const [open, setOpen] = useState(!connected);
  const isAmo = entry.provider === "amocrm";
  const isWazzup = entry.provider === "wazzup";
  const isSipuni = entry.provider === "sipuni";
  const canSync = (isAmo || isWazzup || isSipuni) && connected;
  const syncEndpoint = isWazzup
    ? "/api/sync/wazzup"
    : isSipuni
      ? "/api/sync/sipuni"
      : "/api/sync/amocrm";
  const syncLabel = isWazzup
    ? "Синхронизировать каналы"
    : isSipuni
      ? "Синхронизировать звонки"
      : "Синхронизировать";
  const canTest = isAmo || isWazzup || isSipuni;

  return (
    <div
      className={cn(
        "panel overflow-hidden p-0 transition-colors",
        connected && "border-xray/20",
      )}
    >
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-ink-700 font-display text-lg font-bold text-content">
            {entry.label.slice(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold text-content">
                {entry.label}
              </h3>
              <Badge tone="neutral">{entry.category}</Badge>
            </div>
            <p className="mt-1 max-w-sm text-sm text-content-muted">
              {entry.description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot on={connected} />
          <span
            className={cn(
              "text-xs font-medium",
              connected ? "text-signal-good" : "text-content-faint",
            )}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {canSync && (
        <>
          <div className="rule mx-5" />
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-content">
                {isWazzup ? "Синхронизация каналов и менеджеров" : "Синхронизация данных"}
              </p>
              <p className="text-xs text-content-faint">{syncedAgo(lastSyncedAt)}</p>
              {isAmo && lastAutoSyncedAt && (
                <p className="text-xs text-content-faint">
                  Авто: {syncedAgo(lastAutoSyncedAt)}
                </p>
              )}
              {isWazzup && (
                <p className="mt-0.5 text-xs text-content-faint">
                  История переписки — через вебхуки (следующий шаг).
                </p>
              )}
            </div>
            <SyncButton
              size="sm"
              variant="secondary"
              label={syncLabel}
              endpoint={syncEndpoint}
              showFull={isAmo}
            />
          </div>
          {isWazzup && webhookOrgId && (
            <div className="px-5 pb-4">
              <WazzupWebhook orgId={webhookOrgId} secret={webhookSecret} />
            </div>
          )}
        </>
      )}

      <div className="rule mx-5" />

      <div className="px-5 py-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-content-muted transition-colors hover:text-content"
        >
          {connected ? "Изменить ключи" : "Настроить подключение"}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="mt-4 space-y-4">
            <IntegrationForm
              entry={entry}
              storedKeys={storedKeys}
              submitLabel={connected ? "Обновить" : "Сохранить и подключить"}
            />
            {canTest && connected && <TestConnectionButton provider={entry.provider} />}
            {connected && (
              <form action={disconnectIntegrationAction}>
                <input type="hidden" name="provider" value={entry.provider} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 text-sm text-content-faint transition-colors hover:text-signal-bad"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Отключить интеграцию
                </button>
              </form>
            )}
            {entry.docsUrl && (
              <a
                href={entry.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-content-faint hover:text-content-muted"
              >
                Где взять ключи? Документация {entry.label} ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { requireRole } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getIntegrations } from "@/lib/integrations/queries";
import {
  getSipuniManagers,
  getSipuniManagerMap,
  getUnmappedManagerCodes,
} from "@/lib/integrations/sipuni-managers";
import { INTEGRATION_CATALOG } from "@/lib/integrations/catalog";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { IntegrationCard } from "@/components/integrations/integration-card";
import type { Integration, IntegrationStatus } from "@/lib/types/db";

export const metadata = { title: "Интеграции — Sales X-Ray" };

export default async function IntegrationsPage() {
  const tenant = await requireRole(["OWNER", "ROP"]);
  const integrations = await getIntegrations(tenant.organization.id);

  // Sipuni manager map (extension → name) for the editor on the Sipuni card.
  const supabase = createClient();
  const sipuniManagers = await getSipuniManagers(supabase, tenant.organization.id);
  const sipuniMap = await getSipuniManagerMap(supabase, tenant.organization.id);
  const sipuniUnmapped = await getUnmappedManagerCodes(
    supabase,
    tenant.organization.id,
    sipuniMap,
  );

  const byProvider = new Map<string, Integration>(
    integrations.map((i) => [i.provider, i]),
  );

  return (
    <>
      <PageHeader
        title="Интеграции"
        description="Подключите источники данных. Ключи хранятся отдельно для каждой компании и доступны только на сервере."
      />

      <Alert tone="info" className="mb-6">
        Сейчас сохраняются только настройки. Реальная синхронизация данных будет
        добавлена на следующем этапе — после неё статус «Подключено» начнёт
        отражать живое соединение.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-2">
        {INTEGRATION_CATALOG.map((entry) => {
          const row = byProvider.get(entry.provider);
          const config = (row?.config as Record<string, unknown>) ?? {};
          // Only the NAMES of stored keys leave the server — never the secrets.
          const storedKeys = Object.keys(config).filter((k) =>
            Boolean(config[k]),
          );
          return (
            <IntegrationCard
              key={entry.provider}
              entry={entry}
              status={(row?.status as IntegrationStatus) ?? "NOT_CONNECTED"}
              storedKeys={storedKeys}
              lastSyncedAt={row?.last_synced_at ?? null}
              lastAutoSyncedAt={row?.last_auto_synced_at ?? null}
              webhookOrgId={entry.provider === "wazzup" ? tenant.organization.id : undefined}
              webhookSecret={
                entry.provider === "wazzup"
                  ? ((config.webhook_secret as string | undefined) ?? null)
                  : null
              }
              sipuniManagers={entry.provider === "sipuni" ? sipuniManagers : undefined}
              sipuniUnmapped={entry.provider === "sipuni" ? sipuniUnmapped : undefined}
            />
          );
        })}
      </div>
    </>
  );
}

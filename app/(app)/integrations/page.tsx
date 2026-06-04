import { requireRole } from "@/lib/tenant";
import { getIntegrations } from "@/lib/integrations/queries";
import { INTEGRATION_CATALOG } from "@/lib/integrations/catalog";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { IntegrationCard } from "@/components/integrations/integration-card";
import type { Integration, IntegrationStatus } from "@/lib/types/db";

export const metadata = { title: "Интеграции — Sales X-Ray" };

export default async function IntegrationsPage() {
  const tenant = await requireRole(["OWNER", "ROP"]);
  const integrations = await getIntegrations(tenant.organization.id);

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
            />
          );
        })}
      </div>
    </>
  );
}

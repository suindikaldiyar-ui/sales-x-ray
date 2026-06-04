import { PhoneCall } from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { isProviderConnected } from "@/lib/integrations/queries";
import { PageHeader } from "@/components/app/page-header";
import { NoDataBanner } from "@/components/app/no-data-banner";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Звонки — Sales X-Ray" };

export default async function CallsPage() {
  const tenant = await requireTenant();
  const connected = await isProviderConnected(tenant.organization.id, "sipuni");

  return (
    <>
      <PageHeader
        title="Звонки"
        description="Входящие и исходящие звонки с записями — рядом со сделками."
      />
      <NoDataBanner
        connected={connected}
        canManage={canManageIntegrations(tenant.role)}
      />
      <EmptyState
        icon={<PhoneCall className="h-5 w-5" />}
        title="Звонков пока нет"
        description="Подключите Sipuni на странице «Интеграции» — звонки и записи появятся здесь."
      />
    </>
  );
}

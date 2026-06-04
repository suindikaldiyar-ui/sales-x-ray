import { FileBarChart, Send } from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { isProviderConnected } from "@/lib/integrations/queries";
import { PageHeader } from "@/components/app/page-header";
import { NoDataBanner } from "@/components/app/no-data-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Отчёты — Sales X-Ray" };

export default async function ReportsPage() {
  const tenant = await requireTenant();
  const telegramConnected = await isProviderConnected(
    tenant.organization.id,
    "telegram",
  );
  const amoConnected = await isProviderConnected(
    tenant.organization.id,
    "amocrm",
  );

  return (
    <>
      <PageHeader
        title="Отчёты"
        description="Ежедневные сводки по продажам. Можно автоматически присылать руководителю в Telegram."
        action={
          <Button variant="outline" size="sm" disabled>
            <Send className="h-4 w-4" />
            Отправить в Telegram
          </Button>
        }
      />
      <NoDataBanner
        connected={amoConnected}
        canManage={canManageIntegrations(tenant.role)}
      />
      <EmptyState
        icon={<FileBarChart className="h-5 w-5" />}
        title="Отчётов пока нет"
        description={
          telegramConnected
            ? "Источник данных подключим — и ежедневные отчёты начнут формироваться автоматически."
            : "Подключите amoCRM для данных и Telegram для рассылки на странице «Интеграции»."
        }
      />
    </>
  );
}

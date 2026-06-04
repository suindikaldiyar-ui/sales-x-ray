import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { IntegrationForm } from "@/components/integrations/integration-form";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Подключите amoCRM — Sales X-Ray" };

export default async function ConnectPage() {
  await requireTenant();
  const amocrm = getCatalogEntry("amocrm")!;

  return (
    <div className="panel animate-fade-up p-7 sm:p-8">
      <p className="eyebrow">Шаг 2 из 2</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
        Подключите amoCRM
      </h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Вставьте долгоживущий токен — мы сохраним его за вашей компанией.
        Синхронизация сделок включится автоматически на следующем этапе развития
        сервиса. Можно пропустить и сделать это позже.
      </p>

      <div className="mt-7">
        <IntegrationForm entry={amocrm} submitLabel="Сохранить токен" />
      </div>

      <div className="mt-6 rule" />

      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm text-content-faint">Заполнить позже?</span>
        <Link href="/dashboard">
          <Button variant="ghost" size="sm">
            Перейти в дашборд
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

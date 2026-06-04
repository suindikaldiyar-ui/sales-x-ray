import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getUser } from "@/lib/auth";
import { getTenant } from "@/lib/tenant";
import { CreateOrgForm } from "./create-org-form";

export const metadata = { title: "Настройка компании — Sales X-Ray" };

export default async function OnboardingPage() {
  const user = await getUser();
  const tenant = await getTenant();

  // Already has an organization → straight to the app.
  if (tenant) redirect("/dashboard");

  const pendingName =
    (user?.user_metadata?.pending_org_name as string | undefined) ?? "";

  return (
    <div className="panel animate-fade-up p-7 sm:p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-xray/30 bg-xray/10 text-xray">
        <Building2 className="h-6 w-6" />
      </div>
      <p className="eyebrow mt-6">Шаг 1 из 2</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
        Заведём вашу компанию
      </h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Это рабочее пространство, в которое вы потом пригласите команду.
      </p>

      <div className="mt-7">
        <CreateOrgForm defaultName={pendingName} />
      </div>
    </div>
  );
}

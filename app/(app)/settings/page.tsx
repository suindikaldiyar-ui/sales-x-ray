import Link from "next/link";
import { Building2, BadgeCheck, CreditCard, Plug, Sparkles } from "lucide-react";
import { requireTenant, canManageIntegrations } from "@/lib/tenant";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAiStatus } from "@/lib/ai/settings";
import { fmtDate } from "@/lib/datetime";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { AiSettingsCard } from "@/components/ai/ai-settings-card";
import type { Subscription } from "@/lib/types/db";

export const metadata = { title: "Настройки — Sales X-Ray" };

const PLAN_LABELS: Record<string, string> = {
  TRIAL: "Пробный",
  STARTER: "Старт",
  GROWTH: "Рост",
  SCALE: "Масштаб",
};
const STATUS_LABELS: Record<string, string> = {
  TRIALING: "Пробный период",
  ACTIVE: "Активна",
  PAST_DUE: "Просрочена",
  CANCELED: "Отменена",
};

const formatDate = fmtDate;

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const profile = await getProfile();
  const supabase = createClient();

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("organization_id", tenant.organization.id)
    .maybeSingle();
  const subscription = sub as Subscription | null;

  const ai = await getAiStatus(supabase, tenant.organization.id);
  const canManage = canManageIntegrations(tenant.role);

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Профиль, компания и подписка."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Organization */}
        <Card>
          <CardHeader
            title="Компания"
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-ink-700 text-content-muted">
                <Building2 className="h-4 w-4" />
              </span>
            }
          />
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-content-muted">Название</dt>
              <dd className="font-medium text-content">
                {tenant.organization.name}
              </dd>
            </div>
            <div className="rule" />
            <div className="flex items-center justify-between">
              <dt className="text-content-muted">Идентификатор</dt>
              <dd className="font-mono text-xs text-content-faint">
                {tenant.organization.slug ?? tenant.organization.id.slice(0, 8)}
              </dd>
            </div>
            <div className="rule" />
            <div className="flex items-center justify-between">
              <dt className="text-content-muted">Ваша роль</dt>
              <dd>
                <RoleBadge role={tenant.role} />
              </dd>
            </div>
          </dl>
        </Card>

        {/* Profile */}
        <Card>
          <CardHeader
            title="Ваш профиль"
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-ink-700 text-content-muted">
                <BadgeCheck className="h-4 w-4" />
              </span>
            }
          />
          <div className="flex items-center gap-4">
            <Avatar
              name={profile?.full_name}
              email={profile?.email ?? ""}
              size="lg"
            />
            <div className="min-w-0">
              <p className="font-medium text-content">
                {profile?.full_name ?? "Без имени"}
              </p>
              <p className="truncate text-sm text-content-faint">
                {profile?.email}
              </p>
            </div>
          </div>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader
            title="Подписка"
            subtitle="Биллинг появится позже — сейчас доступен пробный период."
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-ink-700 text-content-muted">
                <CreditCard className="h-4 w-4" />
              </span>
            }
          />
          {subscription ? (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-content-muted">Тариф</dt>
                <dd className="font-medium text-content">
                  {PLAN_LABELS[subscription.plan] ?? subscription.plan}
                </dd>
              </div>
              <div className="rule" />
              <div className="flex items-center justify-between">
                <dt className="text-content-muted">Статус</dt>
                <dd>
                  <Badge
                    tone={subscription.status === "ACTIVE" ? "good" : "warn"}
                  >
                    {STATUS_LABELS[subscription.status] ?? subscription.status}
                  </Badge>
                </dd>
              </div>
              <div className="rule" />
              <div className="flex items-center justify-between">
                <dt className="text-content-muted">Действует до</dt>
                <dd className="text-content">
                  {formatDate(subscription.current_period_end)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-content-muted">
              Информация о подписке недоступна.
            </p>
          )}
        </Card>

        {/* Integrations shortcut */}
        <Card>
          <CardHeader
            title="Интеграции"
            subtitle="amoCRM, Wazzup, Sipuni, Telegram."
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-ink-700 text-content-muted">
                <Plug className="h-4 w-4" />
              </span>
            }
          />
          {canManage ? (
            <Link href="/integrations">
              <Button variant="outline" className="w-full">
                Управлять интеграциями
              </Button>
            </Link>
          ) : (
            <p className="text-sm text-content-muted">
              Управление интеграциями доступно владельцу и РОПу.
            </p>
          )}
        </Card>

        {/* AI (Gemini) */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="AI-анализ (Google Gemini)"
            subtitle="Анализ переписок и AI-отчёты по продажам."
            action={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-xray/30 bg-xray/10 text-xray">
                <Sparkles className="h-4 w-4" />
              </span>
            }
          />
          {canManage ? (
            <AiSettingsCard
              enabled={ai.enabled}
              hasKey={ai.hasKey}
              usingGlobalKey={ai.usingGlobalKey}
              model={ai.model}
            />
          ) : (
            <p className="text-sm text-content-muted">
              AI-анализ {ai.ready ? "включён" : "выключен"}. Управление доступно
              владельцу и РОПу.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

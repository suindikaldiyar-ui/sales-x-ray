import { Users, Mail, Clock } from "lucide-react";
import { requireRole } from "@/lib/tenant";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { RoleBadge, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ROLE_LABELS } from "@/lib/utils";
import type { MembershipRole, Profile } from "@/lib/types/db";
import { InviteForm } from "./invite-form";
import { MemberActions, RevokeInviteButton } from "./member-actions";

export const metadata = { title: "Команда — Sales X-Ray" };

interface MemberRow {
  id: string;
  role: MembershipRole;
  user_id: string;
  profile: Pick<Profile, "id" | "email" | "full_name" | "avatar_url"> | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: MembershipRole;
  created_at: string;
}

export default async function TeamPage() {
  const tenant = await requireRole(["OWNER", "ROP"]);
  const user = await getUser();
  const supabase = createClient();

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, role, user_id, profile:profiles(id, email, full_name, avatar_url)")
      .eq("organization_id", tenant.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("invitations")
      .select("id, email, role, created_at")
      .eq("organization_id", tenant.organization.id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false }),
  ]);

  const rows = (members ?? []).map((m: any) => ({
    ...m,
    profile: Array.isArray(m.profile) ? m.profile[0] : m.profile,
  })) as MemberRow[];
  const pending = (invites as InviteRow[]) ?? [];

  return (
    <>
      <PageHeader
        title="Команда"
        description="Пользователи вашей компании, их роли и приглашения."
        action={
          <Badge tone="neutral">
            <Users className="h-3.5 w-3.5" />
            {rows.length} в команде
          </Badge>
        }
      />

      <Card>
        <CardHeader
          title="Пригласить сотрудника"
          subtitle="Отправим приглашение на email. Роль можно изменить позже."
        />
        <InviteForm />
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="Участники" subtitle="Все, кто имеет доступ к компании" />
          <div className="overflow-hidden rounded-xl border border-line">
            {rows.map((m, i) => {
              const isSelf = m.user_id === user?.id;
              const editable =
                m.role !== "OWNER" && !isSelf && tenant.role !== "MOP";
              const email = m.profile?.email ?? "—";
              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${
                    i > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={m.profile?.full_name} email={email} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-content">
                        {m.profile?.full_name ?? email}
                        {isSelf && (
                          <span className="text-xs text-content-faint">(вы)</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-content-faint">
                        {email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    {editable ? (
                      <MemberActions
                        membershipId={m.id}
                        role={m.role}
                        editable
                      />
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Приглашения"
            subtitle="Ожидают принятия"
            action={
              <Badge tone={pending.length ? "warn" : "neutral"}>
                {pending.length}
              </Badge>
            }
          />
          {pending.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-5 w-5" />}
              title="Активных приглашений нет"
              description="Пригласите сотрудника по email через форму выше."
              className="py-10"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {pending.map((inv, i) => (
                <div
                  key={inv.id}
                  className={`flex items-center justify-between gap-3 p-4 ${
                    i > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-ink-600 text-content-faint">
                      <Clock className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-medium text-content">{inv.email}</p>
                      <p className="text-sm text-content-faint">
                        Приглашён как {ROLE_LABELS[inv.role]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <RoleBadge role={inv.role} />
                    <RevokeInviteButton invitationId={inv.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

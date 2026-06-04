import Link from "next/link";
import { Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { requireUser, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/utils";
import type { MembershipRole } from "@/lib/types/db";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Приглашение — Sales X-Ray" };

export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  // Middleware already redirects unauthenticated users to /login?redirectTo=…
  await requireUser();
  const profile = await getProfile();
  const supabase = createClient();

  // The invitations RLS policy lets the invitee read rows matching their email.
  const { data: inv } = await supabase
    .from("invitations")
    .select("email, role, status, organization:organizations(name)")
    .eq("token", params.token)
    .maybeSingle();

  const org = inv
    ? (Array.isArray((inv as any).organization)
        ? (inv as any).organization[0]
        : (inv as any).organization)
    : null;

  const emailMismatch =
    inv && profile && inv.email.toLowerCase() !== profile.email.toLowerCase();
  const usable = inv && inv.status === "PENDING" && !emailMismatch;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:64px_64px] [mask-image:radial-gradient(60%_50%_at_50%_0%,#000_20%,transparent_100%)]" />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
        <div className="panel w-full max-w-md animate-fade-up p-7 sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-xray/30 bg-xray/10 text-xray">
            <Users className="h-6 w-6" />
          </div>

          {!inv && (
            <>
              <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">
                Приглашение не найдено
              </h1>
              <p className="mt-2 text-sm text-content-muted">
                Ссылка недействительна или приглашение уже использовано.
              </p>
              <Link href="/dashboard" className="mt-6 inline-block">
                <Button variant="outline">В дашборд</Button>
              </Link>
            </>
          )}

          {inv && (
            <>
              <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">
                Вас пригласили в команду
              </h1>
              <p className="mt-2 text-sm text-content-muted">
                Компания{" "}
                <span className="font-medium text-content">
                  «{org?.name ?? "—"}»
                </span>{" "}
                приглашает вас присоединиться.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-content-muted">Ваша роль:</span>
                <RoleBadge role={inv.role as MembershipRole} />
                <span className="text-sm text-content-faint">
                  ({ROLE_LABELS[inv.role as MembershipRole]})
                </span>
              </div>

              <div className="mt-6">
                {usable ? (
                  <AcceptInviteForm token={params.token} />
                ) : emailMismatch ? (
                  <Alert tone="error">
                    Приглашение выписано на {inv.email}, а вы вошли как{" "}
                    {profile?.email}. Войдите под нужным адресом.
                  </Alert>
                ) : (
                  <Alert tone="info">
                    Это приглашение уже неактивно.
                  </Alert>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

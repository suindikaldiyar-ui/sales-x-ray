import { requireTenant } from "@/lib/tenant";
import { getProfile } from "@/lib/auth";
import { visibleNavItems } from "@/lib/nav";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requireTenant();
  const profile = await getProfile();

  return (
    <AppShell
      navItems={visibleNavItems(tenant.role)}
      role={tenant.role}
      user={{
        email: profile?.email ?? "",
        fullName: profile?.full_name ?? null,
      }}
      org={{ id: tenant.organization.id, name: tenant.organization.name }}
      memberships={tenant.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
      }))}
    >
      {children}
    </AppShell>
  );
}

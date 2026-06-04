import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { MembershipRole, Organization } from "@/lib/types/db";

export const ACTIVE_ORG_COOKIE = "sx_active_org";

export interface OrgMembership {
  organization: Organization;
  role: MembershipRole;
}

export interface TenantContext {
  organization: Organization;
  role: MembershipRole;
  /** Every organization the user belongs to (for the org switcher). */
  memberships: OrgMembership[];
}

/** All organizations the current user is a member of, with their role. */
export async function getMemberships(): Promise<OrgMembership[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role, organization:organizations(*)")
    .order("created_at", { ascending: true });

  if (!data) return [];
  return data
    .filter((row) => row.organization)
    .map((row) => ({
      role: row.role as MembershipRole,
      // Supabase types the joined relation as an array; we read the single row.
      organization: (Array.isArray(row.organization)
        ? row.organization[0]
        : row.organization) as Organization,
    }));
}

/**
 * Resolve the active tenant for the current request. The active organization is
 * stored in a cookie; we fall back to the first membership. Returns null when
 * the user has no organization yet (i.e. needs onboarding).
 */
export async function getTenant(): Promise<TenantContext | null> {
  const memberships = await getMemberships();
  if (memberships.length === 0) return null;

  const cookieOrg = cookies().get(ACTIVE_ORG_COOKIE)?.value;
  const active =
    memberships.find((m) => m.organization.id === cookieOrg) ?? memberships[0];

  return {
    organization: active.organization,
    role: active.role,
    memberships,
  };
}

/** Require an active tenant or redirect to onboarding. */
export async function requireTenant(): Promise<TenantContext> {
  await requireUser();
  const tenant = await getTenant();
  if (!tenant) redirect("/onboarding");
  return tenant;
}

/** Require the active membership to hold one of the given roles. */
export async function requireRole(
  roles: MembershipRole[],
): Promise<TenantContext> {
  const tenant = await requireTenant();
  if (!roles.includes(tenant.role)) redirect("/dashboard");
  return tenant;
}

export function canManageTeam(role: MembershipRole): boolean {
  return role === "OWNER" || role === "ROP";
}

export function canManageIntegrations(role: MembershipRole): boolean {
  return role === "OWNER" || role === "ROP";
}

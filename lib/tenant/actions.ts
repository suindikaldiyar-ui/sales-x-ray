"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenant, ACTIVE_ORG_COOKIE } from "@/lib/tenant";
import type { MembershipRole } from "@/lib/types/db";

export interface ActionState {
  error?: string;
  message?: string;
}

/** Create the user's organization (OWNER) via the SECURITY DEFINER function. */
export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("org_name") ?? "").trim();
  if (!name) return { error: "Введите название компании." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orgId, error } = await supabase.rpc("create_organization", {
    org_name: name,
  });
  if (error) return { error: error.message };

  cookies().set(ACTIVE_ORG_COOKIE, orgId as string, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  redirect("/onboarding/connect");
}

/** Switch the active organization (org switcher). */
export async function setActiveOrgAction(formData: FormData) {
  const orgId = String(formData.get("organization_id") ?? "");
  if (orgId) {
    cookies().set(ACTIVE_ORG_COOKIE, orgId, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Invite a teammate by email (OWNER/ROP only). */
export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "MOP") as MembershipRole;
  if (!email) return { error: "Введите email." };
  if (role !== "ROP" && role !== "MOP") return { error: "Недопустимая роль." };

  const { organization } = await requireTenant();
  const supabase = createClient();

  const { error } = await supabase.rpc("invite_member", {
    org: organization.id,
    invite_email: email,
    invite_role: role,
  });
  if (error) return { error: error.message };

  revalidatePath("/team");
  return { message: `Приглашение отправлено: ${email}` };
}

/** Revoke a pending invitation. */
export async function revokeInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("invitation_id") ?? "");
  if (!invitationId) return;
  const supabase = createClient();
  await supabase.rpc("revoke_invitation", { invitation_id: invitationId });
  revalidatePath("/team");
}

/** Change a member's role (OWNER/ROP only; cannot touch OWNER). */
export async function updateMemberRoleAction(formData: FormData) {
  const membershipId = String(formData.get("membership_id") ?? "");
  const role = String(formData.get("role") ?? "") as MembershipRole;
  if (!membershipId || (role !== "ROP" && role !== "MOP")) return;

  await requireTenant();
  const supabase = createClient();
  await supabase.from("memberships").update({ role }).eq("id", membershipId);
  revalidatePath("/team");
}

/** Remove a member from the organization. */
export async function removeMemberAction(formData: FormData) {
  const membershipId = String(formData.get("membership_id") ?? "");
  if (!membershipId) return;
  await requireTenant();
  const supabase = createClient();
  await supabase.from("memberships").delete().eq("id", membershipId);
  revalidatePath("/team");
}

/** Accept an invitation by token (called after the invitee signs in). */
export async function acceptInvitationAction(token: string): Promise<ActionState> {
  const supabase = createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", {
    invite_token: token,
  });
  if (error) return { error: error.message };
  cookies().set(ACTIVE_ORG_COOKIE, orgId as string, { path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
  return { message: "Вы присоединились к организации." };
}

/** Form variant used by the /invite/[token] page: accept then enter the app. */
export async function acceptInviteFormAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "Некорректная ссылка приглашения." };
  const result = await acceptInvitationAction(token);
  if (result.error) return result;
  redirect("/dashboard");
}

// Hand-maintained database types mirroring supabase/migrations.
// (For a generated alternative, run `supabase gen types typescript`.)

export type MembershipRole = "OWNER" | "ROP" | "MOP";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type IntegrationProvider = "amocrm" | "wazzup" | "sipuni" | "telegram";
export type IntegrationStatus = "NOT_CONNECTED" | "CONNECTED" | "ERROR";
export type SubscriptionPlan = "TRIAL" | "STARTER" | "GROWTH" | "SCALE";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: MembershipRole;
  status: InvitationStatus;
  token: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

export interface Integration {
  id: string;
  organization_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A membership joined with its profile — convenient for the Team page. */
export interface MemberWithProfile extends Membership {
  profile: Pick<Profile, "id" | "email" | "full_name" | "avatar_url">;
}

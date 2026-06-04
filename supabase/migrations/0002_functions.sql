-- ============================================================================
-- Sales X-Ray — 0002 functions
-- Tenant helper predicates (used by RLS) and privileged flows for signup and
-- invitations. Helpers are SECURITY DEFINER so that RLS policies which call
-- them do not recurse into the very table they protect (memberships).
-- ============================================================================

-- ─── auth.users → profiles bridge ──────────────────────────────────────────
-- Every new Supabase Auth user gets a matching public.profiles row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── tenant predicates (bypass RLS to avoid recursion) ─────────────────────
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org uuid, roles membership_role[])
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.role = any (roles)
  );
$$;

-- ─── create_organization — used at signup / "create company" ──────────────
-- Creates the org, the OWNER membership for the caller, a trial subscription
-- and empty integration rows for every provider. Returns the new org id.
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_org uuid;
  base_slug text;
  final_slug text;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(org_name), '') = '' then
    raise exception 'organization name is required';
  end if;

  base_slug := regexp_replace(lower(trim(org_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'org'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (trim(org_name), final_slug, auth.uid())
  returning id into new_org;

  insert into public.memberships (organization_id, user_id, role)
  values (new_org, auth.uid(), 'OWNER');

  insert into public.subscriptions (organization_id, plan, status)
  values (new_org, 'TRIAL', 'TRIALING');

  insert into public.integrations (organization_id, provider, status)
  select new_org, p, 'NOT_CONNECTED'
  from unnest(enum_range(null::integration_provider)) as p;

  return new_org;
end $$;

-- ─── invite_member — OWNER/ROP invites by email ────────────────────────────
create or replace function public.invite_member(
  org uuid,
  invite_email text,
  invite_role membership_role default 'MOP'
)
returns public.invitations
language plpgsql
security definer set search_path = public
as $$
declare
  rec public.invitations;
begin
  if not public.has_org_role(org, array['OWNER', 'ROP']::membership_role[]) then
    raise exception 'only OWNER or ROP can invite members';
  end if;
  if invite_role = 'OWNER' then
    raise exception 'cannot invite another OWNER';
  end if;
  if coalesce(trim(invite_email), '') = '' then
    raise exception 'email is required';
  end if;

  -- already a member?
  if exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = org and lower(p.email) = lower(trim(invite_email))
  ) then
    raise exception 'this user is already a member of the organization';
  end if;

  insert into public.invitations (organization_id, email, role, invited_by)
  values (org, lower(trim(invite_email)), invite_role, auth.uid())
  on conflict (organization_id, lower(email)) where (status = 'PENDING')
  do update set role = excluded.role, invited_by = excluded.invited_by,
                created_at = now(), expires_at = now() + interval '7 days'
  returning * into rec;

  return rec;
end $$;

-- ─── accept_invitation — invited user joins after sign-up/sign-in ──────────
create or replace function public.accept_invitation(invite_token uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  inv public.invitations;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select email into user_email from public.profiles where id = auth.uid();

  select * into inv from public.invitations
  where token = invite_token and status = 'PENDING'
  for update;

  if inv.id is null then
    raise exception 'invitation not found or already used';
  end if;
  if inv.expires_at < now() then
    update public.invitations set status = 'EXPIRED' where id = inv.id;
    raise exception 'invitation has expired';
  end if;
  if lower(inv.email) <> lower(coalesce(user_email, '')) then
    raise exception 'this invitation was issued for a different email';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (inv.organization_id, auth.uid(), inv.role)
  on conflict (organization_id, user_id) do nothing;

  update public.invitations set status = 'ACCEPTED' where id = inv.id;

  return inv.organization_id;
end $$;

-- ─── revoke_invitation ─────────────────────────────────────────────────────
create or replace function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  org uuid;
begin
  select organization_id into org from public.invitations where id = invitation_id;
  if org is null then
    raise exception 'invitation not found';
  end if;
  if not public.has_org_role(org, array['OWNER', 'ROP']::membership_role[]) then
    raise exception 'only OWNER or ROP can revoke invitations';
  end if;
  update public.invitations set status = 'REVOKED'
  where id = invitation_id and status = 'PENDING';
end $$;

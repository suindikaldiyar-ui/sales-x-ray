-- ============================================================================
-- Sales X-Ray — 0003 row level security
-- Hard tenant isolation: a user only ever sees rows for organizations they are
-- a member of. Privileged inserts (creating an org, inviting, accepting) go
-- through the SECURITY DEFINER functions in 0002, so most tables expose no
-- direct INSERT policy to regular users.
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.organizations  enable row level security;
alter table public.memberships    enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.invitations    enable row level security;
alter table public.integrations   enable row level security;
alter table public.leads          enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.calls          enable row level security;
alter table public.daily_reports  enable row level security;

-- ─── profiles ──────────────────────────────────────────────────────────────
drop policy if exists profiles_select_self_or_coworker on public.profiles;
create policy profiles_select_self_or_coworker on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships me
      join public.memberships them
        on them.organization_id = me.organization_id
      where me.user_id = auth.uid() and them.user_id = public.profiles.id
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ─── organizations ─────────────────────────────────────────────────────────
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
  for select using (public.is_org_member(id));

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin on public.organizations
  for update using (public.has_org_role(id, array['OWNER','ROP']::membership_role[]))
  with check (public.has_org_role(id, array['OWNER','ROP']::membership_role[]));

-- ─── memberships ───────────────────────────────────────────────────────────
drop policy if exists memberships_select_member on public.memberships;
create policy memberships_select_member on public.memberships
  for select using (public.is_org_member(organization_id));

drop policy if exists memberships_update_admin on public.memberships;
create policy memberships_update_admin on public.memberships
  for update using (public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[]))
  with check (public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[]));

-- OWNER/ROP can remove members; nobody can remove the last OWNER (guard in app).
drop policy if exists memberships_delete_admin on public.memberships;
create policy memberships_delete_admin on public.memberships
  for delete using (
    public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[])
    and role <> 'OWNER'
  );

-- ─── subscriptions (read-only to members; billing managed server-side) ─────
drop policy if exists subscriptions_select_member on public.subscriptions;
create policy subscriptions_select_member on public.subscriptions
  for select using (public.is_org_member(organization_id));

-- ─── invitations ───────────────────────────────────────────────────────────
-- Admins see their org's invitations; an invitee can see ones for their email.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select using (
    public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[])
    or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

-- ─── integrations ──────────────────────────────────────────────────────────
drop policy if exists integrations_select_member on public.integrations;
create policy integrations_select_member on public.integrations
  for select using (public.is_org_member(organization_id));

drop policy if exists integrations_write_admin on public.integrations;
create policy integrations_write_admin on public.integrations
  for all using (public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[]))
  with check (public.has_org_role(organization_id, array['OWNER','ROP']::membership_role[]));

-- ─── data tables: members of the org get full access to their org's rows ───
-- (Bulk sync runs with the service role, which bypasses RLS entirely.)
do $$
declare t text;
begin
  foreach t in array array['leads','conversations','messages','calls','daily_reports']
  loop
    execute format('drop policy if exists %I_rw_member on public.%I;', t, t);
    execute format(
      'create policy %I_rw_member on public.%I for all '
      || 'using (public.is_org_member(organization_id)) '
      || 'with check (public.is_org_member(organization_id));', t, t);
  end loop;
end $$;

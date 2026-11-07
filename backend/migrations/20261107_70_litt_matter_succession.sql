-- Migration date: 2026-11-07
--
-- LiTT: a private matter stays with its team (owner decisions of 2026-11-07,
-- ledger §29.6 questions 1 and 2; TD-038).
--
-- 1. Team access to the matter's project. Every active member of a private
--    matter's team reaches its project with their matter role
--    (matter_owner -> owner, editor -> editor, viewer -> viewer;
--    technical_operator has no content role), whatever the project's own
--    visibility. The access is a project_org_access_overrides row kept in
--    step with matter_memberships by sync_matter_team_project_access, so
--    the SQL verdict (project_access_role), every list RPC and the
--    TypeScript resolver (lib/access.ts) already honour it, and adding,
--    promoting or removing a member changes the access in the same
--    transaction. Nobody outside the team gains anything: the C2 gate
--    (project_private_matter_denied) still refuses everyone without an
--    active matter membership first, organization owners and admins
--    included. Public matters are unchanged.
-- 2. Succession on departure. A second BEFORE DELETE trigger on
--    org_members, matter_succession_on_departure, runs after upstream's
--    cleanup_removed_org_member_overrides (trigger names sort
--    alphabetically) and leaves that upstream function untouched. It revokes
--    the leaver's matter memberships in the organization. On each private
--    matter left without an active matter_owner it promotes the active
--    teammate with the highest role (editor before viewer; the earliest
--    member on a tie); with no teammate left, the successor chosen for the
--    departure becomes matter_owner. Each succession is an insert-only
--    audit event, matter.owner_succeeded.
-- 3. assign_matter_owner(actor, matter, target): an organization owner or
--    admin names a current member of the firm as the matter_owner of one of
--    its matters left without an active owner (themselves included). A
--    matter with an active owner is refused (55000): naming never displaces
--    or demotes an owner, so it cannot take a matter from its team. Naming
--    someone else grants the actor nothing. Audit event matter.owner_assigned
--    with the last owner; the membership change advances the authorization
--    epoch through matter_memberships_epoch_bump.
-- 4. list_matters_without_owner(actor, org): an organization owner or admin
--    lists the firm's matters without an active owner, with no title: the
--    CM number, creation date, last owner and team size.
--
-- No audit detail carries a matter title or content.
-- Safe to re-run: create or replace, drop-before-create triggers, and an
-- idempotent backfill.

create or replace function public.apply_matter_team_project_access(
  p_matter_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  project uuid; matter_org uuid; matter_visibility text;
  project_org uuid; project_creator uuid; project_visibility text;
  project_archived timestamptz; member_role text; team_role text; org_role text;
begin
  select mt.project_id, w.organization_id, mt.visibility
    into project, matter_org, matter_visibility
  from public.matters mt join public.workspaces w on w.id = mt.workspace_id
  where mt.id = p_matter_id;
  -- Public matters keep their own rules; a matter without a project has
  -- nothing to open.
  if project is null or matter_visibility <> 'private' then return; end if;

  select mm.role into member_role from public.matter_memberships mm
  where mm.matter_id = p_matter_id and mm.user_id = p_user_id and mm.status = 'active';
  team_role := case member_role
    when 'matter_owner' then 'owner'
    when 'editor' then 'editor'
    when 'viewer' then 'viewer'
  end;
  if team_role is null then
    delete from public.project_org_access_overrides
    where project_id = project and user_id = p_user_id;
    return;
  end if;

  select p.org_id, p.user_id, p.visibility, p.archived_at
    into project_org, project_creator, project_visibility, project_archived
  from public.projects p where p.id = project;
  select m.role into org_role from public.org_members m
  where m.org_id = matter_org and m.user_id = p_user_id;
  -- Cases the override guard refuses, where the member already holds at
  -- least this role or nobody may hold one: someone outside the
  -- organization, the project's creator (always owner), an organization
  -- owner on an organization-visible project (always owner), an archived
  -- project or one filed in another organization.
  if org_role is null
     or project_org is distinct from matter_org
     or project_archived is not null
     or project_creator = p_user_id
     or (org_role = 'owner' and project_visibility = 'organization') then
    return;
  end if;
  insert into public.project_org_access_overrides(project_id, org_id, user_id, role)
  values (project, matter_org, p_user_id, team_role)
  on conflict (project_id, user_id) do update
    set role = excluded.role, updated_at = now()
    where public.project_org_access_overrides.role is distinct from excluded.role;
end;
$$;

revoke all on function public.apply_matter_team_project_access(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.sync_matter_team_project_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.apply_matter_team_project_access(old.matter_id, old.user_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and (tg_op = 'INSERT' or (new.matter_id, new.user_id) is distinct from (old.matter_id, old.user_id)
          or (new.role, new.status) is distinct from (old.role, old.status)) then
    perform public.apply_matter_team_project_access(new.matter_id, new.user_id);
  end if;
  return null;
end;
$$;

revoke all on function public.sync_matter_team_project_access()
  from public, anon, authenticated;

drop trigger if exists matter_memberships_team_project_access on public.matter_memberships;
create trigger matter_memberships_team_project_access
  after insert or update or delete on public.matter_memberships
  for each row execute function public.sync_matter_team_project_access();

-- Re-pointing a matter at another project, or making it private, moves the
-- team's access with it. The team keeps nothing on a project the matter no
-- longer owns.
create or replace function public.sync_matter_scope_team_project_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare member record;
begin
  if (new.project_id, new.visibility, new.workspace_id)
     is not distinct from (old.project_id, old.visibility, old.workspace_id) then
    return null;
  end if;
  if old.project_id is not null and old.project_id is distinct from new.project_id then
    delete from public.project_org_access_overrides o
    using public.matter_memberships mm
    where o.project_id = old.project_id and mm.matter_id = new.id and mm.user_id = o.user_id;
  end if;
  for member in select user_id from public.matter_memberships where matter_id = new.id loop
    perform public.apply_matter_team_project_access(new.id, member.user_id);
  end loop;
  return null;
end;
$$;

revoke all on function public.sync_matter_scope_team_project_access()
  from public, anon, authenticated;

drop trigger if exists matters_team_project_access on public.matters;
create trigger matters_team_project_access
  after update on public.matters
  for each row execute function public.sync_matter_scope_team_project_access();

-- Backfill: the teams of existing private matters.
do $$
declare member record;
begin
  for member in
    select mm.matter_id, mm.user_id
    from public.matter_memberships mm
    join public.matters mt on mt.id = mm.matter_id
    where mt.visibility = 'private' and mt.project_id is not null
    order by mm.matter_id, mm.user_id
  loop
    perform public.apply_matter_team_project_access(member.matter_id, member.user_id);
  end loop;
end;
$$;

-- An active owner of a matter: an active matter_owner membership held by a
-- current member of the matter's organization.
create or replace function public.matter_has_active_owner(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matter_memberships mm
    join public.matters mt on mt.id = mm.matter_id
    join public.workspaces w on w.id = mt.workspace_id
    join public.org_members m on m.org_id = w.organization_id and m.user_id = mm.user_id
    where mm.matter_id = p_matter_id
      and mm.role = 'matter_owner'
      and mm.status = 'active'
  );
$$;

revoke all on function public.matter_has_active_owner(uuid) from public, anon, authenticated;

create or replace function public.matter_succession_on_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active boolean; successor uuid; actor uuid; matter record; heir uuid; reason text;
begin
  if not public.org_is_team(old.org_id) then return old; end if;
  -- cleanup_removed_org_member_overrides has already locked this row.
  select deleted_at is null into active from public.organizations where id = old.org_id;
  if not found then return old; end if;
  if active then
    successor := coalesce(nullif(current_setting('mike.departure_successor', true), '')::uuid,
      public.org_default_departure_successor(old.org_id, array[old.user_id]));
    actor := coalesce(nullif(current_setting('mike.departure_actor', true), '')::uuid, successor);
  end if;
  for matter in
    select mt.id, mt.visibility
    from public.matters mt
    join public.workspaces w on w.id = mt.workspace_id
    join public.matter_memberships mm on mm.matter_id = mt.id
    where w.organization_id = old.org_id
      and mm.user_id = old.user_id
      and mm.status = 'active'
    order by mt.id
    for update of mt
  loop
    update public.matter_memberships set status = 'revoked'
    where matter_id = matter.id and user_id = old.user_id;
    -- Public matters keep their own rules.
    if matter.visibility <> 'private' or not active then continue; end if;
    if exists (
      select 1 from public.matter_memberships mm
      join public.org_members m on m.org_id = old.org_id and m.user_id = mm.user_id
      where mm.matter_id = matter.id and mm.role = 'matter_owner' and mm.status = 'active'
        and mm.user_id <> old.user_id
    ) then
      continue;
    end if;
    select mm.user_id into heir
    from public.matter_memberships mm
    join public.org_members m on m.org_id = old.org_id and m.user_id = mm.user_id
    where mm.matter_id = matter.id and mm.status = 'active'
      and mm.user_id <> old.user_id and mm.role in ('editor', 'viewer')
    order by case mm.role when 'editor' then 0 else 1 end, mm.created_at, mm.user_id
    limit 1;
    if heir is not null then
      reason := 'team_member_promoted';
      update public.matter_memberships set role = 'matter_owner'
      where matter_id = matter.id and user_id = heir;
    elsif successor is not null and successor <> old.user_id
          and exists (select 1 from public.org_members m
                      where m.org_id = old.org_id and m.user_id = successor) then
      heir := successor;
      reason := 'departure_successor';
      insert into public.matter_memberships(matter_id, user_id, role, status)
      values (matter.id, heir, 'matter_owner', 'active')
      on conflict (matter_id, user_id) do update set role = 'matter_owner', status = 'active';
    else
      -- Listed by list_matters_without_owner until someone is named.
      continue;
    end if;
    insert into public.audit_events(user_id, org_id, action, surface, detail)
    values (actor, old.org_id, 'matter.owner_succeeded', 'organization',
      jsonb_build_object('org_id', old.org_id, 'matter_id', matter.id,
        'target_user_id', heir, 'reason', reason));
    heir := null;
  end loop;
  return old;
end;
$$;

revoke all on function public.matter_succession_on_departure() from public, anon, authenticated;

drop trigger if exists org_members_matter_succession on public.org_members;
create trigger org_members_matter_succession
  before delete on public.org_members
  for each row execute function public.matter_succession_on_departure();

-- Errors: P0002 the matter (or organization) is unknown to the actor;
-- 42501 the actor is a member but neither owner nor admin; 22023 the target
-- is not a current member of the firm (or is deleting their account);
-- 55000 the matter already has an active owner.
create or replace function public.assign_matter_owner(
  p_actor_id uuid,
  p_matter_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matter_org uuid; actor_role text; last_owner uuid;
begin
  select w.organization_id into matter_org
  from public.matters mt join public.workspaces w on w.id = mt.workspace_id
  where mt.id = p_matter_id;
  if matter_org is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  -- The organization fence that departures and membership changes take.
  perform 1 from public.organizations
  where id = matter_org and deleted_at is null and kind = 'team' for update;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  select m.role into actor_role from public.org_members m
  where m.org_id = matter_org and m.user_id = p_actor_id;
  if actor_role is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if actor_role not in ('owner', 'admin') then
    raise exception 'Only an organization owner or admin can name a matter owner'
      using errcode = '42501';
  end if;
  if p_target_user_id is null
     or not exists (select 1 from public.org_members m
                    where m.org_id = matter_org and m.user_id = p_target_user_id)
     or exists (select 1 from public.user_profiles p
                where p.user_id = p_target_user_id and p.account_deletion_requested_at is not null) then
    raise exception 'The new matter owner must be a current member of the organization'
      using errcode = '22023';
  end if;
  perform 1 from public.matters where id = p_matter_id for update;

  -- Only a matter left without an owner can be given one: naming never
  -- displaces an active owner, so it cannot take a matter from its team.
  if public.matter_has_active_owner(p_matter_id) then
    raise exception 'The matter already has an active owner'
      using errcode = '55000';
  end if;

  select mm.user_id into last_owner from public.matter_memberships mm
  where mm.matter_id = p_matter_id and mm.role = 'matter_owner'
  order by mm.created_at desc, mm.user_id
  limit 1;

  insert into public.matter_memberships(matter_id, user_id, role, status)
  values (p_matter_id, p_target_user_id, 'matter_owner', 'active')
  on conflict (matter_id, user_id) do update set role = 'matter_owner', status = 'active';

  insert into public.audit_events(user_id, org_id, action, surface, detail)
  values (p_actor_id, matter_org, 'matter.owner_assigned', 'organization',
    jsonb_build_object('org_id', matter_org, 'matter_id', p_matter_id,
      'target_user_id', p_target_user_id,
      'reason', case when p_target_user_id = p_actor_id then 'self_appointed' else 'appointed' end,
      'last_owner_user_id', last_owner));

  return jsonb_build_object('matter_id', p_matter_id, 'owner_user_id', p_target_user_id);
end;
$$;

revoke all on function public.assign_matter_owner(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_matter_owner(uuid, uuid, uuid) to service_role;

-- No title: administrators never see the names of matters they are not on
-- (docs/organization-offboarding.md). Errors as assign_matter_owner.
create or replace function public.list_matters_without_owner(
  p_actor_id uuid,
  p_org_id uuid
)
returns table (
  matter_id uuid,
  cm_number text,
  visibility text,
  created_at timestamptz,
  last_owner_user_id uuid,
  last_owner_display_name text,
  last_owner_email text,
  member_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare actor_role text;
begin
  select m.role into actor_role
  from public.org_members m join public.organizations o on o.id = m.org_id
  where m.org_id = p_org_id and m.user_id = p_actor_id and o.deleted_at is null;
  if actor_role is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if actor_role not in ('owner', 'admin') then
    raise exception 'Only an organization owner or admin can list matters without an owner'
      using errcode = '42501';
  end if;
  return query
  select mt.id, mt.cm_number, mt.visibility, mt.created_at,
    last_owner.user_id, p.display_name, p.email,
    (select count(*)::integer
     from public.matter_memberships mm
     join public.org_members m on m.org_id = p_org_id and m.user_id = mm.user_id
     where mm.matter_id = mt.id and mm.status = 'active')
  from public.matters mt
  join public.workspaces w on w.id = mt.workspace_id
  left join lateral (
    select mm.user_id from public.matter_memberships mm
    where mm.matter_id = mt.id and mm.role = 'matter_owner'
    order by mm.created_at desc, mm.user_id
    limit 1
  ) last_owner on true
  left join public.user_profiles p on p.user_id = last_owner.user_id
  where w.organization_id = p_org_id
    and not public.matter_has_active_owner(mt.id)
  order by mt.created_at desc, mt.id;
end;
$$;

revoke all on function public.list_matters_without_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_matters_without_owner(uuid, uuid) to service_role;

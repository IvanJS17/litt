-- Migration date: 2026-11-26
--
-- The project of a private matter is private, whatever its own visibility
-- column says, so that the matter team reaches it only with its matter roles.
--
-- 1. matters_keep_project_private: binding a project to a private matter, or
--    making the matter private, sets the project's visibility to private.
-- 2. projects_keep_matter_project_private: the visibility of a project bound
--    to a private matter cannot be set to anything else.
-- 3. org_members_matter_team_access: a person put on a matter's team before
--    joining the organization, or whose organization role changes, has their
--    matter role written (apply_matter_team_project_access ran only on the
--    team and matter changes).
-- 4. Backfill for existing matters.
--
-- Safe to re-run: create or replace, drop-before-create triggers, idempotent
-- backfill.

-- A private matter's project is private whatever its own visibility column
-- says: the team reaches it with its matter roles (project_org_access_overrides,
-- written by apply_matter_team_project_access), and nobody reaches it through
-- the organization's visibility. Keeping the column private is what makes the
-- absence of an override mean "no content role" (a technical operator) instead
-- of the editor that organization visibility gives every member.
create or replace function public.keep_private_matter_project_private()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility = 'private' and new.project_id is not null then
    update public.projects
    set visibility = 'private'
    where id = new.project_id and visibility is distinct from 'private';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_private_matter_project_private()
  from public, anon, authenticated;

drop trigger if exists matters_keep_project_private on public.matters;
create trigger matters_keep_project_private
  before insert or update of project_id, visibility on public.matters
  for each row execute function public.keep_private_matter_project_private();

create or replace function public.keep_matter_project_private()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is distinct from 'private'
     and exists (
       select 1 from public.matters mt
       where mt.project_id = new.id and mt.visibility = 'private'
     ) then
    new.visibility := 'private';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_matter_project_private()
  from public, anon, authenticated;

drop trigger if exists projects_keep_matter_project_private on public.projects;
create trigger projects_keep_matter_project_private
  before update of visibility on public.projects
  for each row execute function public.keep_matter_project_private();

-- A person put on a matter's team before joining the organization, or whose
-- organization role changed since, has their matter role (re)written.
create or replace function public.sync_org_member_matter_team_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare membership record;
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return null;
  end if;
  for membership in
    select mm.matter_id
    from public.matter_memberships mm
    join public.matters mt on mt.id = mm.matter_id
    join public.workspaces w on w.id = mt.workspace_id
    where mm.user_id = new.user_id
      and w.organization_id = new.org_id
      and mt.visibility = 'private'
      and mt.project_id is not null
  loop
    perform public.apply_matter_team_project_access(membership.matter_id, new.user_id);
  end loop;
  return null;
end;
$$;

revoke all on function public.sync_org_member_matter_team_access()
  from public, anon, authenticated;

drop trigger if exists org_members_matter_team_access on public.org_members;
create trigger org_members_matter_team_access
  after insert or update of role on public.org_members
  for each row execute function public.sync_org_member_matter_team_access();

-- Backfill: projects of private matters become private, and each team's
-- matter roles are written again now that the project's visibility no longer
-- stands in for them.
update public.projects p
set visibility = 'private'
where p.visibility is distinct from 'private'
  and exists (
    select 1 from public.matters mt
    where mt.project_id = p.id and mt.visibility = 'private'
  );

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

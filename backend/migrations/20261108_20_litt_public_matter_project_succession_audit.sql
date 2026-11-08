-- Migration date: 2026-11-08
--
-- LiTT: audit the succession of the private project of a public matter
-- (follow-up to 20261108_10_litt_public_matter_project_succession.sql, which
-- already shipped and is not edited).
--
--   * Each project passed on is an insert-only audit event,
--     matter.private_project_succeeded, written the way
--     matter.owner_succeeded is (audit_events, surface 'organization', actor
--     = the departure's actor). Its detail carries ids only: org_id,
--     matter_id, project_id, from_user_id (the leaver) and target_user_id
--     (the heir). No project or matter name, no free text.
--   * The exit log's member.departed event counts only the items handed to the
--     departure's successor ("transferred"), so it read 0 for a departure
--     that passed projects to a matter team. Those are now reported apart
--     as one org_departure_events row, member.projects_succeeded, with
--     {succeeded_projects: n} (mirrored to audit as
--     org.departure.member.projects_succeeded). Upstream's departure
--     function and its count are untouched.
--
-- The trigger keeps its name, and so its order before upstream's
-- org_members_cleanup_access_overrides, which
-- performance.litt-matter-departure-paths.sql pins.
--
-- Safe to re-run: create or replace.

create or replace function public.public_matter_project_succession_on_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active boolean; successor uuid; actor uuid; project record; heir uuid; passed integer := 0;
begin
  if not public.org_is_team(old.org_id) then return old; end if;
  select deleted_at is null into active from public.organizations
  where id = old.org_id for update;
  -- A deleted organization transfers nothing; its departure items are archived.
  if not found or not active then return old; end if;
  successor := coalesce(nullif(current_setting('mike.departure_successor', true), '')::uuid,
    public.org_default_departure_successor(old.org_id, array[old.user_id]));
  actor := coalesce(nullif(current_setting('mike.departure_actor', true), '')::uuid, successor);

  for project in
    select p.id, mt.id as matter_id
    from public.projects p
    join public.matters mt on mt.project_id = p.id
    join public.workspaces w on w.id = mt.workspace_id
    where p.org_id = old.org_id
      and w.organization_id = old.org_id
      and p.user_id = old.user_id
      and p.visibility = 'private'
      and p.archived_at is null
      and mt.visibility <> 'private'
    order by p.id, mt.id
    for update of p
  loop
    select mm.user_id into heir
    from public.matter_memberships mm
    join public.org_members m on m.org_id = old.org_id and m.user_id = mm.user_id
    where mm.matter_id = project.matter_id and mm.status = 'active'
      and mm.user_id <> old.user_id
      and mm.role in ('matter_owner', 'editor', 'viewer')
    order by case mm.role when 'matter_owner' then 0 when 'editor' then 1 else 2 end,
      mm.created_at, mm.user_id
    limit 1;
    if heir is null and successor is not null and successor <> old.user_id
       and exists (select 1 from public.org_members m
                   where m.org_id = old.org_id and m.user_id = successor) then
      heir := successor;
    end if;
    if heir is not null then
      insert into public.project_org_access_overrides(project_id, org_id, user_id, role)
      values (project.id, old.org_id, heir, 'owner')
      on conflict (project_id, user_id) do update
        set role = 'owner', updated_at = now()
        where public.project_org_access_overrides.role is distinct from 'owner';
      -- Insert-only, ids only: no project or matter name, no free text.
      insert into public.audit_events(user_id, org_id, action, surface, detail)
      values (actor, old.org_id, 'matter.private_project_succeeded', 'organization',
        jsonb_build_object('org_id', old.org_id, 'matter_id', project.matter_id,
          'project_id', project.id, 'from_user_id', old.user_id, 'target_user_id', heir));
      passed := passed + 1;
    end if;
    heir := null;
  end loop;
  -- The exit log's member.departed counts only the items handed to the
  -- departure's successor; the projects passed on to a matter team are
  -- reported apart, in the same log.
  if passed > 0 then
    insert into public.org_departure_events(org_id, actor_id, action, detail)
    values (old.org_id, actor, 'member.projects_succeeded',
      jsonb_build_object('succeeded_projects', passed));
  end if;
  return old;
end;
$$;

revoke all on function public.public_matter_project_succession_on_departure()
  from public, anon, authenticated;

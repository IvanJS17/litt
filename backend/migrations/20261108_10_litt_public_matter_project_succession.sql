-- Migration date: 2026-11-08
--
-- LiTT: the private project of a public matter stays with the matter's team
-- when its creator leaves (owner decision of 2026-11-08, extending the rule
-- of 20261107_70_litt_matter_succession.sql and the owner's rule of
-- 2026-10-24: work inside the firm's matters stays with the firm).
--
-- Until now, on a public matter whose project was private, the project
-- became nobody's when its creator left: upstream's departure trigger clears
-- the creator, and the matter exclusion keeps it out of the departure items.
-- A BEFORE DELETE trigger on org_members, org_members_a_public_matter_project_succession,
-- now hands each such project over:
--
--   * to the active matter teammate with the highest matter role
--     (matter_owner, then editor, then viewer; the earliest member on a
--     tie, then user_id, the same order as the private-matter succession);
--     technical_operator holds no content role and never inherits;
--   * with no teammate left, to the successor chosen for the departure.
--
-- The heir receives a project_org_access_overrides row with role 'owner', the
-- mechanism the private-matter team already uses, so project_access_role,
-- the list RPCs and the TypeScript resolver honour it unchanged. An
-- organization owner or admin does not inherit by being one. Only private,
-- unarchived projects the leaver created are touched; the matter itself,
-- its memberships and every other project are unchanged. Archived work is
-- left to its own restore path.
--
-- The trigger is named to sort BEFORE upstream's
-- org_members_cleanup_access_overrides (triggers fire in name order): that
-- function clears projects.user_id, after which the creator can no longer be
-- told apart. It takes the same organization lock first, then the affected
-- projects in id order, so the lock order is the one departures already use.
-- Upstream's function is untouched and still removes the leaver's own
-- overrides.
--
-- Safe to re-run: create or replace, drop-before-create trigger.

create or replace function public.public_matter_project_succession_on_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active boolean; successor uuid; project record; heir uuid;
begin
  if not public.org_is_team(old.org_id) then return old; end if;
  select deleted_at is null into active from public.organizations
  where id = old.org_id for update;
  -- A deleted organization transfers nothing; its departure items are archived.
  if not found or not active then return old; end if;
  successor := coalesce(nullif(current_setting('mike.departure_successor', true), '')::uuid,
    public.org_default_departure_successor(old.org_id, array[old.user_id]));

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
    end if;
    heir := null;
  end loop;
  return old;
end;
$$;

revoke all on function public.public_matter_project_succession_on_departure()
  from public, anon, authenticated;

drop trigger if exists org_members_a_public_matter_project_succession on public.org_members;
create trigger org_members_a_public_matter_project_succession
  before delete on public.org_members
  for each row execute function public.public_matter_project_succession_on_departure();

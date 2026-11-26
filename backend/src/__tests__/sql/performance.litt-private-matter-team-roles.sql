-- A private matter's project is private whatever its own visibility column
-- says: the team reaches it with its matter roles and nobody reaches it by
-- the organization's visibility.
--
--   1. Binding an organization-visible project to a private matter, making a
--      matter private, or opening the project afterwards leaves it private.
--   2. A technical operator has no content role; a viewer reads; an editor
--      edits.
--   3. An organization owner on the team holds the matter role, also after
--      being demoted, and so does somebody who joins the organization after
--      being put on the team.
begin;
do $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  firm_owner uuid := gen_random_uuid(); creator uuid := gen_random_uuid();
  operator uuid := gen_random_uuid(); viewer uuid := gen_random_uuid();
  editor uuid := gen_random_uuid(); owner_viewer uuid := gen_random_uuid();
  late uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  pm uuid := gen_random_uuid(); later_pm uuid := gen_random_uuid();
  matter uuid; later_matter uuid;
  role_of text;
begin
  insert into auth.users(id,email) values
    (firm_owner,firm_owner||'@example.test'),(creator,creator||'@example.test'),
    (operator,operator||'@example.test'),(viewer,viewer||'@example.test'),
    (editor,editor||'@example.test'),(owner_viewer,owner_viewer||'@example.test'),
    (late,late||'@example.test'),(outsider,outsider||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',firm_owner);
  insert into public.org_members(org_id,user_id,role) values
    (org,firm_owner,'owner'),(org,creator,'member'),(org,operator,'member'),
    (org,viewer,'member'),(org,editor,'member'),(org,owner_viewer,'owner'),
    (org,outsider,'member');
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');

  -- 1. An organization-visible project, then bound to a private matter.
  insert into public.projects(id,user_id,org_id,name,visibility)
    values(pm,creator,org,'Matter project','organization');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,pm,'Private matter','private') returning id into matter;
  assert (select visibility from public.projects where id=pm) = 'private',
    'binding to a private matter leaves the project private';
  insert into public.matter_memberships(matter_id,user_id,role) values
    (matter,creator,'matter_owner'),(matter,operator,'technical_operator'),
    (matter,viewer,'viewer'),(matter,editor,'editor'),(matter,owner_viewer,'viewer'),
    (matter,late,'viewer');
  update public.projects set visibility='organization' where id=pm;
  assert (select visibility from public.projects where id=pm) = 'private',
    'opening the project of a private matter changes nothing';

  -- 2. Matter roles are the only content roles.
  assert coalesce(public.project_access_role(pm,creator,org,operator::text,operator||'@example.test'),'none') = 'none',
    'technical operator has no content role';
  assert public.project_access_role(pm,creator,org,viewer::text,viewer||'@example.test') = 'viewer',
    'viewer reads';
  assert public.project_access_role(pm,creator,org,editor::text,editor||'@example.test') = 'editor',
    'editor edits';
  assert coalesce(public.project_access_role(pm,creator,org,outsider::text,outsider||'@example.test'),'none') = 'none',
    'a member outside the team has no role';
  assert coalesce(public.project_access_role(pm,creator,org,firm_owner::text,firm_owner||'@example.test'),'none') = 'none',
    'an organization owner outside the team has no role';

  -- 3. An organization owner on the team holds the matter role, also after demotion.
  assert public.project_access_role(pm,creator,org,owner_viewer::text,owner_viewer||'@example.test') = 'viewer',
    'organization owner who is a viewer of the matter is a viewer';
  update public.org_members set role='member' where org_id=org and user_id=owner_viewer;
  assert public.project_access_role(pm,creator,org,owner_viewer::text,owner_viewer||'@example.test') = 'viewer',
    'demoted organization owner stays a viewer';

  -- Somebody put on the team before joining the organization is a viewer once they join.
  assert coalesce(public.project_access_role(pm,creator,org,late::text,late||'@example.test'),'none') = 'none',
    'not yet a member of the organization';
  insert into public.org_members(org_id,user_id,role) values(org,late,'member');
  assert public.project_access_role(pm,creator,org,late::text,late||'@example.test') = 'viewer',
    'a viewer who joins the organization later is a viewer';

  -- A matter made private later takes its project with it.
  insert into public.projects(id,user_id,org_id,name,visibility)
    values(later_pm,creator,org,'Later project','organization');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,later_pm,'Open matter','public') returning id into later_matter;
  assert (select visibility from public.projects where id=later_pm) = 'organization',
    'the project of an open matter keeps its visibility';
  update public.matters set visibility='private' where id=later_matter;
  assert (select visibility from public.projects where id=later_pm) = 'private',
    'making a matter private makes its project private';
end;
$$;
rollback;

-- The migration that keeps the project of a private matter private also
-- rewrites existing data. This test puts the data in the shape it had before
-- (triggers off, the project organization-visible, the matter team's roles
-- computed from that visibility), runs the migration file itself over it, and
-- looks at the result:
--
--   1. The organization-visible project of a private matter becomes private.
--   2. The project of a public matter keeps its visibility.
--   3. A team member keeps their matter role; a member with no content role
--      (a technical operator, somebody off the team) ends with none.
--   4. A project of another organization is not made private by binding it to
--      a matter of this one.
--
-- The migration is read relative to this file.
begin;

create temp table backfill_ids(name text primary key, id uuid not null) on commit drop;
do $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  firm_owner uuid := gen_random_uuid(); creator uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid(); editor uuid := gen_random_uuid();
  operator uuid := gen_random_uuid(); off_team uuid := gen_random_uuid();
  private_project uuid := gen_random_uuid(); public_project uuid := gen_random_uuid();
  private_matter uuid; public_matter uuid;
begin
  insert into backfill_ids values
    ('org',org),('creator',creator),('viewer',viewer),('editor',editor),('operator',operator),
    ('off_team',off_team),('private_project',private_project),('public_project',public_project);
  insert into auth.users(id,email) values
    (firm_owner,firm_owner||'@example.test'),(creator,creator||'@example.test'),
    (viewer,viewer||'@example.test'),(editor,editor||'@example.test'),
    (operator,operator||'@example.test'),(off_team,off_team||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',firm_owner);
  insert into public.org_members(org_id,user_id,role) values
    (org,firm_owner,'owner'),(org,creator,'member'),(org,viewer,'member'),
    (org,editor,'member'),(org,operator,'member'),(org,off_team,'member');
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');

  -- The shape before the migration: nothing keeps the project private.
  alter table public.matters disable trigger matters_keep_project_private;
  alter table public.projects disable trigger projects_keep_matter_project_private;
  insert into public.projects(id,user_id,org_id,name,visibility) values
    (private_project,creator,org,'Private matter project','organization'),
    (public_project,creator,org,'Public matter project','organization');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,private_project,'Private matter','private') returning id into private_matter;
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,public_project,'Public matter','public') returning id into public_matter;
  insert into public.matter_memberships(matter_id,user_id,role) values
    (private_matter,creator,'matter_owner'),(private_matter,viewer,'viewer'),
    (private_matter,editor,'editor'),(private_matter,operator,'technical_operator');
  -- The roles the team had before the migration are not there to be found.
  delete from public.project_org_access_overrides where project_id = private_project;
  assert (select visibility from public.projects where id=private_project) = 'organization',
    'the prepared project is organization-visible, as before the migration';
end;
$$;

\ir ../../../migrations/20261126_01_litt_private_matter_project_private.sql

do $$
declare
  org uuid := (select id from backfill_ids where name='org');
  creator uuid := (select id from backfill_ids where name='creator');
  private_project uuid := (select id from backfill_ids where name='private_project');
  public_project uuid := (select id from backfill_ids where name='public_project');
  other_org uuid := gen_random_uuid(); other_ws uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid(); foreign_project uuid := gen_random_uuid();
  who record;
begin
  assert (select visibility from public.projects where id=private_project) = 'private',
    'the backfill makes the project of a private matter private';
  assert (select visibility from public.projects where id=public_project) = 'organization',
    'the project of a public matter keeps its visibility';

  for who in
    select name, case name when 'viewer' then 'viewer' when 'editor' then 'editor' else 'none' end as expected
    from backfill_ids where name in ('viewer','editor','operator','off_team')
  loop
    assert coalesce(public.project_access_role(
        private_project, creator, org, (select id from backfill_ids where name=who.name)::text,
        (select id from backfill_ids where name=who.name)||'@example.test'), 'none') = who.expected,
      'after the backfill ' || who.name || ' has ' || who.expected;
  end loop;

  -- A project of another organization is left alone by a matter of this one.
  insert into auth.users(id,email) values(other_owner,other_owner||'@example.test');
  insert into public.organizations(id,name,created_by) values(other_org,'Other synthetic firm',other_owner);
  insert into public.org_members(org_id,user_id,role) values(other_org,other_owner,'owner');
  insert into public.workspaces(id,organization_id,name) values(other_ws,other_org,'Other workspace');
  insert into public.projects(id,user_id,org_id,name,visibility)
    values(foreign_project,other_owner,other_org,'Other organization project','organization');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values((select id from public.workspaces where organization_id=org limit 1),foreign_project,'Binds a foreign project','private');
  assert (select visibility from public.projects where id=foreign_project) = 'organization',
    'binding a project of another organization does not change it';
end;
$$;
rollback;

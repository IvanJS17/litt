-- Negative controls for performance.litt-private-matters.sql (LiTT C2).
-- That file proves every list and verdict hides a private matter from
-- everyone outside its team. These controls prove the proof depends on
-- LiTT's guards and not on fixture luck: each block swaps one guard for
-- upstream's text (or switches it off) inside a rolled-back transaction and
-- asserts the matter then leaks. If a control stops leaking, the fixture no
-- longer exercises the guard and the main file would pass without it.
--
-- They run in CI with the rest of the performance.*.sql loop
-- (.github/workflows/schema-drift.yml); littPrivateMatterLists.postgres.test.ts
-- runs the full assertion file under the same swaps locally.

create function pg_temp.litt_matter_fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); creator uuid := gen_random_uuid();
  teammate uuid := gen_random_uuid();
  matter_project uuid := gen_random_uuid(); matter uuid;
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.test'),(creator,creator||'@example.test'),
    (teammate,teammate||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',owner_id);
  insert into public.org_members(org_id,user_id,role) values
    (org,owner_id,'owner'),(org,creator,'member'),(org,teammate,'member');
  insert into public.projects(id,user_id,org_id,name,visibility)
    values(matter_project,creator,org,'Matter needle','organization');
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,matter_project,'Private matter','private') returning id into matter;
  insert into public.matter_memberships(matter_id,user_id,role) values
    (matter,creator,'matter_owner'),(matter,teammate,'editor');
  perform set_config('litt.org',org::text,true);
  perform set_config('litt.owner',owner_id::text,true);
  perform set_config('litt.creator',creator::text,true);
  perform set_config('litt.matter_project',matter_project::text,true);
end;
$$;

-- Guarded schema: the organization owner is outside the team and sees
-- nothing; the creator's departure does not list the matter project.
begin;
select pg_temp.litt_matter_fixture();
do $$
declare pm uuid := current_setting('litt.matter_project')::uuid; owner_id uuid := current_setting('litt.owner')::uuid;
begin
  assert public.project_access_role(pm,current_setting('litt.creator')::uuid,current_setting('litt.org')::uuid,owner_id::text,null) is null,
    'guarded: owner has no project_access_role on the matter project';
  assert not exists(select 1 from public.project_list_access(owner_id::text,null,null) where project_id=pm),
    'guarded: owner does not list the matter project';
  assert not exists(select 1 from public.org_members_departure_items(current_setting('litt.org')::uuid,array[current_setting('litt.creator')::uuid])
    where kind='project' and item_id=pm), 'guarded: departure keeps the matter project with the team';
end;
$$;
rollback;

-- Control 1: upstream's project_access_role (20261101_03, S2) without
-- LiTT's first branch hands the matter project to the organization owner.
begin;
select pg_temp.litt_matter_fixture();
\ir ../../../migrations/20261101_03_member_lookup_by_uuid.sql
do $$
declare pm uuid := current_setting('litt.matter_project')::uuid; owner_id uuid := current_setting('litt.owner')::uuid;
begin
  assert public.project_access_role(pm,current_setting('litt.creator')::uuid,current_setting('litt.org')::uuid,owner_id::text,null) is not null,
    'control 1: upstream 20261101_03 alone must leak the matter project (the fixture no longer exercises the guard)';
  assert exists(select 1 from public.project_list_access(owner_id::text,null,null) where project_id=pm),
    'control 1: upstream 20261101_03 alone must leak through project_list_access';
end;
$$;
\ir ../../../migrations/20261101_50_litt_project_access_private_matter.sql
do $$
begin
  assert public.project_access_role(current_setting('litt.matter_project')::uuid,current_setting('litt.creator')::uuid,
    current_setting('litt.org')::uuid,current_setting('litt.owner'),null) is null,
    'control 1: 20261101_50 after upstream restores the guard';
end;
$$;
rollback;

-- Control 2: upstream's departure rewrite (20261101_08, S4b) without the
-- matter exclusion lists the creator's matter project as a departure item.
begin;
select pg_temp.litt_matter_fixture();
\ir ../../../migrations/20261101_08_departure_reverse_references.sql
do $$
begin
  assert exists(select 1 from public.org_members_departure_items(current_setting('litt.org')::uuid,array[current_setting('litt.creator')::uuid])
    where kind='project' and item_id=current_setting('litt.matter_project')::uuid),
    'control 2: upstream 20261101_08 alone must list the matter project (the fixture no longer exercises the guard)';
end;
$$;
\ir ../../../migrations/20261101_51_litt_departure_private_matter.sql
do $$
begin
  assert not exists(select 1 from public.org_members_departure_items(current_setting('litt.org')::uuid,array[current_setting('litt.creator')::uuid])
    where kind='project' and item_id=current_setting('litt.matter_project')::uuid),
    'control 2: 20261101_51 after upstream restores the exclusion';
end;
$$;
rollback;

-- Control 3: with project_private_matter_denied switched off, the lists
-- leak the matter to the organization owner.
begin;
select pg_temp.litt_matter_fixture();
create or replace function public.project_private_matter_denied(p_project_id uuid, p_user_id text)
  returns boolean language sql stable security definer set search_path = public as $$ select false $$;
do $$
declare pm uuid := current_setting('litt.matter_project')::uuid; owner_id uuid := current_setting('litt.owner')::uuid;
begin
  assert exists(select 1 from public.project_list_access(owner_id::text,null,null) where project_id=pm),
    'control 3: with the guard off the owner must list the matter project';
  assert exists(select 1 from public.get_projects_overview(owner_id::text,null,'all',100,0,null,'created','desc',null,null,null) where id=pm),
    'control 3: with the guard off get_projects_overview must leak';
end;
$$;
rollback;

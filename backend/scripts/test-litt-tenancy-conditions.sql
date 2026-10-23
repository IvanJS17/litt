-- LiTT tenancy conditions over the converged schema (docs/UPSTREAM_SYNC_PLAN.md §3).
-- Disposable local PostgreSQL only; run against a database built from
-- backend/schema.sql. Every check runs and is reported; the script fails at the
-- end if any check failed. All fixtures are rolled back.
--
--   C2  a private matter's project is invisible in SQL to its creator, the
--       organization owner and admins (also through upstream's ownerless and
--       administrative private-content paths) unless they are matter members;
--   C3  audit_events rejects UPDATE and DELETE;
--   C4  removing an organization or matter member, or making a matter
--       private, advances the organization's authorization epoch, and a write
--       authorized under the old epoch fails;
--   C5  a team organization cannot be deleted, soft-deleted or purged.
\set ON_ERROR_STOP 1
begin;

create temporary table litt_check(name text primary key, ok boolean not null, detail text);

create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into litt_check values (p_name, coalesce(p_ok, false), p_detail);
$$;

-- Fixtures: a team organization with an owner, an admin with upstream's
-- private-content permission, a matter member, and the project's creator.
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'admin@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'member@example.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'creator@example.test');
insert into public.organizations(id, name, created_by, kind) values
  ('00000000-0000-4000-8000-0000000000b1', 'Firm', '00000000-0000-4000-8000-0000000000a1', 'team');
insert into public.org_members(org_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'admin'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a3', 'member'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a4', 'member');
update public.org_members set can_access_private_content = true
  where user_id = '00000000-0000-4000-8000-0000000000a2';
-- Project P1: organization-visible, bound to a private matter.
-- Project P2: private, ownerless (no creator), bound to a private matter.
insert into public.projects(id, user_id, name, org_id, visibility) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a4', 'P1',
   '00000000-0000-4000-8000-0000000000b1', 'organization'),
  ('00000000-0000-4000-8000-0000000000c2', null, 'P2',
   '00000000-0000-4000-8000-0000000000b1', 'private');

do $$ begin
  insert into public.workspaces(id, organization_id, name) values
    ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'Litigation');
  insert into public.matters(id, workspace_id, project_id, name, visibility) values
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1',
     '00000000-0000-4000-8000-0000000000c1', 'Matter 1', 'private'),
    ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d1',
     '00000000-0000-4000-8000-0000000000c2', 'Matter 2', 'private');
  insert into public.matter_memberships(matter_id, user_id, role) values
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a3', 'editor'),
    ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a3', 'editor');
  perform pg_temp.check('fixtures: workspace and matters', true);
exception when others then
  perform pg_temp.check('fixtures: workspace and matters', false, sqlerrm);
end $$;

-- C2 ---------------------------------------------------------------------
create function pg_temp.role_of(p_project uuid, p_user uuid) returns text language sql as $$
  select public.project_access_role(p.id, p.user_id, p.org_id, p_user::text, u.email)
  from public.projects p, auth.users u where p.id = p_project and u.id = p_user;
$$;

do $$
declare
  r text;
  who record;
begin
  -- The upstream admin path needs an opened private-content grant.
  begin
    insert into public.org_private_content_access(org_id, user_id, kind, item_id)
    values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2',
            'project', '00000000-0000-4000-8000-0000000000c2');
  exception when others then null;
  end;
  for who in select * from (values
      ('creator', '00000000-0000-4000-8000-0000000000a4'::uuid),
      ('org owner', '00000000-0000-4000-8000-0000000000a1'::uuid),
      ('org admin', '00000000-0000-4000-8000-0000000000a2'::uuid)) v(label, id)
  loop
    begin
      r := pg_temp.role_of('00000000-0000-4000-8000-0000000000c1', who.id);
      perform pg_temp.check('C2 private matter, org-visible project: no role for ' || who.label, r is null, 'role=' || coalesce(r, 'null'));
      r := pg_temp.role_of('00000000-0000-4000-8000-0000000000c2', who.id);
      perform pg_temp.check('C2 private matter, ownerless project: no role for ' || who.label, r is null, 'role=' || coalesce(r, 'null'));
    exception when others then
      perform pg_temp.check('C2 private matter: no role for ' || who.label, false, sqlerrm);
    end;
  end loop;
  begin
    r := pg_temp.role_of('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a3');
    perform pg_temp.check('C2 matter member keeps access', r is not null, 'role=' || coalesce(r, 'null'));
  exception when others then
    perform pg_temp.check('C2 matter member keeps access', false, sqlerrm);
  end;
  begin
    r := public.project_access_scope('00000000-0000-4000-8000-0000000000c1',
      '00000000-0000-4000-8000-0000000000b1', 'organization');
    perform pg_temp.check('C2 private matter project is labelled private', r = 'private', 'scope=' || coalesce(r, 'null'));
  exception when others then
    perform pg_temp.check('C2 private matter project is labelled private', false, sqlerrm);
  end;
  begin
    perform pg_temp.check('C2 no standing owner access to private content',
      not public.can_access_org_private_content('00000000-0000-4000-8000-0000000000b1',
        '00000000-0000-4000-8000-0000000000a1'));
  exception when others then
    perform pg_temp.check('C2 no standing owner access to private content', false, sqlerrm);
  end;
  begin
    perform pg_temp.check('C2 private matter project absent from the owner overview',
      not exists (select 1 from public.get_project_ids_overview(
        '00000000-0000-4000-8000-0000000000a1', 'owner@example.test', 'all', null, null, null, 100, 0) o
        where o.id in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2')));
  exception when others then
    perform pg_temp.check('C2 private matter project absent from the owner overview', false, sqlerrm);
  end;
end $$;

-- C2, lists, ownerless and departure (20261023_13) -------------------------
do $$
declare ids uuid[];
begin
  begin
    select array_agg(x order by x) into ids from public.private_matter_denied_project_ids(
      '00000000-0000-4000-8000-0000000000a1',
      array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2']::uuid[]) x;
    perform pg_temp.check('C2 list filter denies both private-matter projects to the org owner',
      ids = array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2']::uuid[],
      coalesce(ids::text, 'null'));
    select array_agg(x) into ids from public.private_matter_denied_project_ids(
      '00000000-0000-4000-8000-0000000000a3',
      array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2']::uuid[]) x;
    perform pg_temp.check('C2 list filter denies nothing to the matter member', ids is null, coalesce(ids::text, 'null'));
  exception when others then
    perform pg_temp.check('C2 list filter', false, sqlerrm);
  end;
  begin
    perform pg_temp.check('C2 a matter project is never ownerless',
      not public.project_is_ownerless('00000000-0000-4000-8000-0000000000c2', null,
        '00000000-0000-4000-8000-0000000000b1'));
  exception when others then
    perform pg_temp.check('C2 a matter project is never ownerless', false, sqlerrm);
  end;
  begin
    perform pg_temp.check('C2 a departing creator does not take a matter project out of the team',
      not exists (select 1 from public.org_members_departure_items(
        '00000000-0000-4000-8000-0000000000b1', array['00000000-0000-4000-8000-0000000000a4']::uuid[]) i
        where i.item_id = '00000000-0000-4000-8000-0000000000c1'));
  exception when others then
    perform pg_temp.check('C2 a departing creator does not take a matter project out of the team', false, sqlerrm);
  end;
end $$;

-- C3 ---------------------------------------------------------------------
insert into public.audit_events(user_id, org_id, action)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'litt.test');
do $$ begin
  begin
    update public.audit_events set action = 'rewritten' where action = 'litt.test';
    perform pg_temp.check('C3 audit UPDATE rejected', false, 'update succeeded');
  exception when others then
    perform pg_temp.check('C3 audit UPDATE rejected', sqlstate = '55000', sqlstate || ' ' || sqlerrm);
  end;
  begin
    delete from public.audit_events where action = 'litt.test';
    perform pg_temp.check('C3 audit DELETE rejected', false, 'delete succeeded');
  exception when others then
    perform pg_temp.check('C3 audit DELETE rejected', sqlstate = '55000', sqlstate || ' ' || sqlerrm);
  end;
end $$;

-- C4 ---------------------------------------------------------------------
create function pg_temp.epoch() returns bigint language sql as $$
  -- Read through jsonb so this script also runs (and fails) on a schema
  -- without the column.
  select (to_jsonb(o) ->> 'authorization_epoch')::bigint
  from public.organizations o where o.id = '00000000-0000-4000-8000-0000000000b1';
$$;

do $$
declare
  e0 bigint;
  e1 bigint;
begin
  begin
    e0 := pg_temp.epoch();
    perform public.ai_assert_active_matter_access('00000000-0000-4000-8000-0000000000a3',
      '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000c1', e0, 'write');
    perform pg_temp.check('C4 member authorized at the current epoch', true);
  exception when others then
    perform pg_temp.check('C4 member authorized at the current epoch', false, sqlerrm);
  end;
  begin
    e0 := pg_temp.epoch();
    delete from public.matter_memberships
      where matter_id = '00000000-0000-4000-8000-0000000000e2'
        and user_id = '00000000-0000-4000-8000-0000000000a3';
    e1 := pg_temp.epoch();
    perform pg_temp.check('C4 deleting a matter member advances the epoch', e1 > e0, e0 || ' -> ' || e1);
    e0 := e1;
    update public.matters set visibility = 'public' where id = '00000000-0000-4000-8000-0000000000e2';
    update public.matters set visibility = 'private' where id = '00000000-0000-4000-8000-0000000000e2';
    e1 := pg_temp.epoch();
    perform pg_temp.check('C4 changing matter visibility advances the epoch', e1 >= e0 + 2, e0 || ' -> ' || e1);
    e0 := e1;
    delete from public.org_members
      where org_id = '00000000-0000-4000-8000-0000000000b1'
        and user_id = '00000000-0000-4000-8000-0000000000a3';
    e1 := pg_temp.epoch();
    perform pg_temp.check('C4 deleting an organization member advances the epoch', e1 > e0, e0 || ' -> ' || e1);
  exception when others then
    perform pg_temp.check('C4 epoch advances on deletes', false, sqlerrm);
  end;
  begin
    perform public.ai_assert_active_matter_access('00000000-0000-4000-8000-0000000000a3',
      '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000c1', e0, 'write');
    perform pg_temp.check('C4 write under the old epoch fails', false, 'authorized');
  exception when others then
    perform pg_temp.check('C4 write under the old epoch fails', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.ai_assert_active_matter_access('00000000-0000-4000-8000-0000000000a3',
      '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000c1', pg_temp.epoch(), 'write');
    perform pg_temp.check('C4 removed member fails at the new epoch', false, 'authorized');
  exception when others then
    perform pg_temp.check('C4 removed member fails at the new epoch', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform pg_temp.check('C4 removed member loses SQL project access',
      pg_temp.role_of('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a3') is null);
  exception when others then
    perform pg_temp.check('C4 removed member loses SQL project access', false, sqlerrm);
  end;
end $$;

-- C5 ---------------------------------------------------------------------
do $$
declare n integer;
begin
  begin
    perform public.soft_delete_organization('00000000-0000-4000-8000-0000000000b1',
      '00000000-0000-4000-8000-0000000000a1');
    perform pg_temp.check('C5 soft delete rejected', false, 'soft-deleted');
  exception when others then
    perform pg_temp.check('C5 soft delete rejected', sqlstate = '0A000', sqlstate || ' ' || sqlerrm);
  end;
  begin
    update public.organizations set deleted_at = now() - interval '40 days',
      purge_after = now() - interval '10 days'
      where id = '00000000-0000-4000-8000-0000000000b1';
    n := public.purge_expired_organizations(10);
    perform pg_temp.check('C5 purge removes nothing',
      n = 0 and exists (select 1 from public.projects where id = '00000000-0000-4000-8000-0000000000c1'),
      'purged=' || n);
  exception when others then
    perform pg_temp.check('C5 purge removes nothing', false, sqlerrm);
  end;
  begin
    delete from public.organizations where id = '00000000-0000-4000-8000-0000000000b1';
    perform pg_temp.check('C5 team organization delete rejected', false, 'deleted');
  exception when others then
    perform pg_temp.check('C5 team organization delete rejected', sqlstate = '0A000', sqlstate || ' ' || sqlerrm);
  end;
end $$;

select case when ok then 'PASS' else 'FAIL' end || '  ' || name ||
       coalesce('  [' || detail || ']', '') as result
from litt_check order by name;

do $$ begin
  if exists (select 1 from litt_check where not ok) then
    raise exception 'LiTT tenancy conditions: % of % checks failed',
      (select count(*) from litt_check where not ok), (select count(*) from litt_check);
  end if;
end $$;
rollback;

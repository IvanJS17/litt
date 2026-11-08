-- The private project of a public matter follows its creator out of the firm
-- by every departure path, and the trigger that does it keeps firing first
-- (migrations 20261108_10_litt_public_matter_project_succession and
-- 20261108_20_litt_public_matter_project_succession_audit; ledger §24.3).
--
-- 1. Trigger order. PostgreSQL fires triggers of the same kind in name order.
--    org_members_a_public_matter_project_succession must fire before every
--    BEFORE DELETE trigger on org_members that clears projects.user_id or
--    deletes access overrides (upstream's org_members_cleanup_access_overrides
--    today): once the creator is cleared the leaver's private project can no
--    longer be told apart. This fails if the trigger is renamed, disabled or
--    dropped, and if an upstream trigger that does either lands in front of it.
-- 2. Paths other than a direct DELETE FROM org_members:
--      * remove_org_member with the owner's chosen successor;
--      * remove_org_member by the creator leaving, default successor;
--      * prepare_account_org_departures followed by deleting the Auth user;
--    Account deletion always runs prepare_account_org_departures first
--    (request_account_deletion); a bare DELETE on auth.users with the
--    membership still in place is not a supported path (matter_succession_on_departure
--    updates memberships of a user the cascade is deleting) and is not tested.
--    Each leaves one owner override and one audit event on the project, and
--    nothing for an organization owner or admin unless the departure named
--    one as its successor.
-- 3. Tie-break: the teammate with the highest matter role, then the earliest
--    member, then the lowest user id.
begin;

-- 1. Trigger order.
do $$
declare
  ours constant text := 'org_members_a_public_matter_project_succession';
  cleaner record; found_cleaner boolean := false;
begin
  assert exists(select 1 from pg_trigger t
    where t.tgrelid = 'public.org_members'::regclass and t.tgname = ours
      and not t.tgisinternal and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8),
    ours || ' must be an enabled BEFORE DELETE row trigger on org_members';
  for cleaner in
    select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.org_members'::regclass and not t.tgisinternal
      and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8 and t.tgname <> ours
      -- Functions that clear a creator or delete project overrides.
      and (p.prosrc ~* 'update\s+public\.projects\s+set\s+user_id\s*=\s*null'
        or p.prosrc ~* 'delete\s+from\s+public\.project_org_access_overrides')
  loop
    found_cleaner := true;
    assert ours collate "C" < cleaner.tgname collate "C",
      format('%s fires before %s (%s): the leaver''s private projects would be cleared first',
        cleaner.tgname, ours, cleaner.proname);
  end loop;
  -- The detector is not vacuous: upstream's cleanup trigger is among them.
  assert found_cleaner and exists(select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.org_members'::regclass and t.tgname = 'org_members_cleanup_access_overrides'
      and p.proname = 'cleanup_removed_org_member_overrides'),
    'org_members_cleanup_access_overrides was not found to compare against';
  -- The succession must also precede the other LiTT departure trigger that
  -- revokes memberships, so the matter team it reads is still intact.
  assert ours collate "C" < 'org_members_matter_succession' collate "C",
    'the project succession reads the matter team before matter_succession revokes the leaver';
end;
$$;
rollback;

-- Fixture. creator leaves; lo and hi are teammates on the public matter whose
-- user ids sort lowest and highest. p_teammates adds them; p_tie gives them
-- the same joining time (otherwise hi joined earlier).
create function pg_temp.fixture(p_teammates boolean, p_tie boolean default false) returns void
language plpgsql as $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid(); proj uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  successor uuid := gen_random_uuid(); creator uuid := gen_random_uuid();
  lo uuid := '00000000-0000-4000-8000-0000000000a1'; hi uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  matter uuid; other_project uuid := gen_random_uuid(); other_matter uuid;
  t timestamptz := now() - interval '2 days';
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),
    (successor,successor||'@example.test'),(creator,creator||'@example.test'),
    (lo,lo||'@example.test'),(hi,hi||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',owner_id);
  insert into public.org_members(org_id,user_id,role) values
    (org,owner_id,'owner'),(org,admin_id,'admin'),(org,successor,'member'),
    (org,creator,'member'),(org,lo,'member'),(org,hi,'member');
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');
  insert into public.projects(id,user_id,org_id,name,visibility) values
    (proj,creator,org,'Public matter, private project','private'),
    (other_project,creator,org,'Private matter, private project','private');
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,proj,'Public matter','CM-P','public') returning id into matter;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,other_project,'Private matter','CM-Q','private') returning id into other_matter;
  insert into public.matter_memberships(matter_id,user_id,role,created_at) values
    (matter,creator,'matter_owner',t - interval '5 days'),
    (other_matter,creator,'matter_owner',t - interval '5 days');
  if p_teammates then
    insert into public.matter_memberships(matter_id,user_id,role,created_at) values
      (matter,lo,'editor',t),
      (matter,hi,'editor',case when p_tie then t else t - interval '1 day' end);
  end if;
  perform set_config('litt.org',org::text,true);
  perform set_config('litt.owner',owner_id::text,true);
  perform set_config('litt.admin',admin_id::text,true);
  perform set_config('litt.successor',successor::text,true);
  perform set_config('litt.creator',creator::text,true);
  perform set_config('litt.lo',lo::text,true);
  perform set_config('litt.hi',hi::text,true);
  perform set_config('litt.project',proj::text,true);
  perform set_config('litt.matter',matter::text,true);
end;
$$;

-- Asserts the project passed to exactly p_heir as owner (a current_setting
-- key). p_actor is the departure's actor (used once the audit event exists).
create function pg_temp.expect(p_case text, p_heir text, p_actor text) returns void
language plpgsql as $$
declare
  proj uuid := current_setting('litt.project')::uuid;
begin
  assert (select array_agg(o.user_id||':'||o.role) from public.project_org_access_overrides o
    where o.project_id = proj) = array[current_setting(p_heir)||':owner'],
    p_case || ': the project has one override, the heir as owner (so not the leaver, and not an organization owner or admin unless chosen)';
end;
$$;

-- 2a. remove_org_member by the owner with a chosen successor, no teammate.
begin;
select pg_temp.fixture(false);
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.creator')::uuid,
  current_setting('litt.owner')::uuid, current_setting('litt.successor')::uuid);
select pg_temp.expect('RPC, chosen successor', 'litt.successor', 'litt.owner');
rollback;

-- 2b. remove_org_member by the owner with a teammate: the teammate wins over
-- the chosen successor; hi joined earlier than lo.
begin;
select pg_temp.fixture(true);
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.creator')::uuid,
  current_setting('litt.owner')::uuid, current_setting('litt.successor')::uuid);
select pg_temp.expect('RPC, teammate', 'litt.hi', 'litt.owner');
rollback;

-- 2c. The creator leaves on their own, default successor (an organization
-- owner), no teammate: the owner receives it only because the departure
-- named them, and the actor is the leaver.
begin;
select pg_temp.fixture(false);
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.creator')::uuid,
  current_setting('litt.creator')::uuid, null);
select pg_temp.expect('RPC, leaving, default successor', 'litt.owner', 'litt.creator');
rollback;

-- 2d. Account deletion: the departure RPC the deletion request runs, then the
-- Auth user itself. The override survives the user.
begin;
select pg_temp.fixture(true);
select public.prepare_account_org_departures(current_setting('litt.creator')::uuid);
select pg_temp.expect('account deletion, prepare', 'litt.hi', 'litt.creator');
delete from auth.users where id = current_setting('litt.creator')::uuid;
do $$
begin
  assert (select array_agg(o.user_id) from public.project_org_access_overrides o
    where o.project_id = current_setting('litt.project')::uuid) = array[current_setting('litt.hi')::uuid],
    'account deletion: the override outlives the deleted account';
  assert (select count(*) from public.audit_events where action = 'matter.private_project_succeeded'
    and org_id = current_setting('litt.org')::uuid) = 1,
    'account deletion: the audit event outlives the deleted account';
end;
$$;
rollback;

-- 3. Tie-break: same joining time, same role: the lowest user id.
begin;
select pg_temp.fixture(true, true);
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.creator')::uuid,
  current_setting('litt.owner')::uuid, null);
select pg_temp.expect('tie-break', 'litt.lo', 'litt.owner');
rollback;

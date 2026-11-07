-- A private matter's team, and the matter owner named by the firm (owner
-- decisions of 2026-11-07, ledger §29.6; migration
-- 20261107_70_litt_matter_succession).
--
--   1. The active team reaches a private matter's private project with its
--      matter roles. The firm's owner and admin, a plain member and another
--      firm do not.
--   2. assign_matter_owner: an organization owner or admin names a current
--      member of the firm (themselves included) on a matter without an active
--      owner. A matter with an active owner is refused (55000) and nobody's
--      role changes, so neither the owner nor an admin naming themselves can
--      take it from its team. An editor cannot name; a member of another firm
--      and a member deleting their account cannot be named. Naming someone
--      else grants the actor nothing; the authorization epoch advances and the
--      audit event records the last owner, with no title.
--   3. list_matters_without_owner: owners and admins only, with no title.
--   4. Both functions are security definer, fixed search_path, service_role
--      only.
begin;
create temporary table litt_succession_actors(label text primary key, uid uuid);
do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  creator uuid := gen_random_uuid(); editor uuid := gen_random_uuid();
  member uuid := gen_random_uuid(); leaving uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  pm uuid := gen_random_uuid(); vacant_pm uuid := gen_random_uuid();
  matter uuid; ownerless uuid; vacant uuid; empty uuid;
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),
    (creator,creator||'@example.test'),(editor,editor||'@example.test'),
    (member,member||'@example.test'),(leaving,leaving||'@example.test'),
    (outsider,outsider||'@example.test');
  insert into public.organizations(id,name,created_by) values
    (org,'Synthetic firm',owner_id),(other_org,'Other synthetic firm',outsider);
  insert into public.org_members(org_id,user_id,role) values
    (org,owner_id,'owner'),(org,admin_id,'admin'),(org,creator,'member'),
    (org,editor,'member'),(org,member,'member'),(org,leaving,'member'),
    (other_org,outsider,'owner');
  insert into public.user_profiles(user_id,email,account_deletion_requested_at)
    values(leaving,leaving||'@example.test',now())
    on conflict (user_id) do update set account_deletion_requested_at=excluded.account_deletion_requested_at;
  insert into litt_succession_actors values
    ('owner',owner_id),('admin',admin_id),('creator',creator),('editor',editor),
    ('member',member),('leaving',leaving),('outsider',outsider);
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');
  insert into public.projects(id,user_id,org_id,name,visibility)
    values(pm,creator,org,'Succession secret matter','private');
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pm,'Succession secret matter','CM-SUCC','private') returning id into matter;
  insert into public.matter_memberships(matter_id,user_id,role) values
    (matter,creator,'matter_owner'),(matter,editor,'editor');
  -- A matter nobody owns: its only member is a viewer.
  insert into public.matters(workspace_id,name,cm_number,visibility)
    values(ws,'Ownerless secret matter','CM-NONE','private') returning id into ownerless;
  insert into public.matter_memberships(matter_id,user_id,role) values(ownerless,member,'viewer');
  -- A matter whose owner is no longer active, with an editor left, and a
  -- matter with no team at all: both are named an owner in step 2.
  insert into public.projects(id,user_id,org_id,name,visibility)
    values(vacant_pm,creator,org,'Vacant secret matter','private');
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,vacant_pm,'Vacant secret matter','CM-VAC','private') returning id into vacant;
  insert into public.matter_memberships(matter_id,user_id,role,status) values
    (vacant,creator,'matter_owner','inactive'),(vacant,editor,'editor','active');
  insert into public.matters(workspace_id,name,cm_number,visibility)
    values(ws,'Empty secret matter','CM-EMPTY','private') returning id into empty;
  perform set_config('litt.org',org::text,true);
  perform set_config('litt.pm',pm::text,true);
  perform set_config('litt.matter',matter::text,true);
  perform set_config('litt.ownerless',ownerless::text,true);
  perform set_config('litt.vacant',vacant::text,true);
  perform set_config('litt.vacant_pm',vacant_pm::text,true);
  perform set_config('litt.empty',empty::text,true);
end;
$$;

create function pg_temp.uid(p_label text) returns uuid language sql as $$
  select uid from litt_succession_actors where label=p_label;
$$;
create function pg_temp.reach_on(p_label text, p_project uuid) returns text language sql as $$
  select coalesce(public.project_access_role(p.id,p.user_id,p.org_id,a.uid::text,a.uid||'@example.test'),'none')
    ||'/'||case when exists(select 1 from public.project_list_access(a.uid::text,a.uid||'@example.test',null) l
      where l.project_id=p.id) then 'listed' else 'unlisted' end
  from litt_succession_actors a, public.projects p
  where a.label=p_label and p.id=p_project;
$$;
create function pg_temp.reach(p_label text) returns text language sql as $$
  select pg_temp.reach_on(p_label, current_setting('litt.pm')::uuid);
$$;
-- Every membership of a matter, as label:role:status, for before/after checks.
create function pg_temp.team(p_matter uuid) returns text language sql as $$
  select coalesce(string_agg(a.label||':'||mm.role||':'||mm.status, ',' order by a.label),'')
  from public.matter_memberships mm join litt_succession_actors a on a.uid=mm.user_id
  where mm.matter_id=p_matter;
$$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
create function pg_temp.epoch() returns bigint language sql as $$
  select authorization_epoch from public.organizations where id=current_setting('litt.org')::uuid;
$$;

-- 1. The team reaches the private project; nobody else does.
do $$
declare a record;
begin
  for a in select label from litt_succession_actors loop
    assert pg_temp.reach(a.label) = case a.label when 'creator' then 'owner/listed'
      when 'editor' then 'editor/listed' else 'none/unlisted' end,
      format('team access: %s reaches %s', a.label, pg_temp.reach(a.label));
  end loop;
  -- A viewer is a viewer, and leaving the team ends the access.
  update public.matter_memberships set role='viewer'
    where matter_id=current_setting('litt.matter')::uuid and user_id=pg_temp.uid('editor');
  assert pg_temp.reach('editor') = 'viewer/listed', 'team access follows the matter role';
  update public.matter_memberships set status='inactive'
    where matter_id=current_setting('litt.matter')::uuid and user_id=pg_temp.uid('editor');
  assert pg_temp.reach('editor') = 'none/unlisted', 'an inactive member has no access';
  update public.matter_memberships set role='editor',status='active'
    where matter_id=current_setting('litt.matter')::uuid and user_id=pg_temp.uid('editor');
  assert pg_temp.reach('editor') = 'editor/listed', 'reactivated member';
end;
$$;

-- 2. Naming the matter owner.
do $$
declare
  org uuid := current_setting('litt.org')::uuid;
  matter uuid := current_setting('litt.matter')::uuid;
  vacant uuid := current_setting('litt.vacant')::uuid;
  empty uuid := current_setting('litt.empty')::uuid;
  vacant_pm uuid := current_setting('litt.vacant_pm')::uuid;
  e0 bigint; result jsonb; event record; before_team text;
begin
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('editor'),vacant,pg_temp.uid('editor'))) = '42501', 'an editor cannot name an owner';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('outsider'),vacant,pg_temp.uid('outsider'))) = 'P0002', 'another firm does not see the matter';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('owner'),vacant,pg_temp.uid('outsider'))) = '22023', 'a member of another firm cannot be named';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('owner'),vacant,pg_temp.uid('leaving'))) = '22023', 'a member deleting their account cannot be named';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('owner'),gen_random_uuid(),pg_temp.uid('member'))) = 'P0002', 'unknown matter';

  -- A matter with an active owner keeps it: the firm's owner cannot name
  -- someone else, the admin cannot name themselves, and naming the current
  -- owner again is refused too. Nobody's role changes.
  before_team := pg_temp.team(matter);
  assert before_team = 'creator:matter_owner:active,editor:editor:active', 'team before: '||before_team;
  e0 := pg_temp.epoch();
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('owner'),matter,pg_temp.uid('member'))) = '55000', 'the owner cannot replace an active owner';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('owner'),matter,pg_temp.uid('editor'))) = '55000', 'nor promote a teammate over them';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('admin'),matter,pg_temp.uid('admin'))) = '55000', 'the admin cannot take a matter with an owner';
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('admin'),matter,pg_temp.uid('creator'))) = '55000', 'naming the current owner again is refused';
  assert pg_temp.team(matter) = before_team, 'a refusal changes nobody''s role: '||pg_temp.team(matter);
  assert pg_temp.epoch() = e0, 'a refusal does not advance the epoch';
  assert pg_temp.reach('admin') = 'none/unlisted' and pg_temp.reach('member') = 'none/unlisted'
    and pg_temp.reach('creator') = 'owner/listed', 'a refusal changes nobody''s access';
  assert not exists(select 1 from public.audit_events where action='matter.owner_assigned' and org_id=org),
    'refusals record nothing';

  -- The admin names themselves on a matter whose owner is no longer active.
  e0 := pg_temp.epoch();
  result := public.assign_matter_owner(pg_temp.uid('admin'),vacant,pg_temp.uid('admin'));
  assert result = jsonb_build_object('matter_id',vacant,'owner_user_id',pg_temp.uid('admin')), 'admin names themselves';
  assert pg_temp.epoch() > e0, 'naming an owner advances the authorization epoch';
  assert pg_temp.reach_on('admin',vacant_pm) = 'owner/listed', 'the admin owns the project';
  assert pg_temp.team(vacant) = 'admin:matter_owner:active,creator:matter_owner:inactive,editor:editor:active',
    'nobody else changes: '||pg_temp.team(vacant);
  select * into event from public.audit_events where action='matter.owner_assigned' and org_id=org;
  assert event.user_id = pg_temp.uid('admin'), 'audit actor';
  assert event.title is null and event.project_id is null, 'the audit event has no title or project';
  assert event.detail = jsonb_build_object('org_id',org,'matter_id',vacant,
    'target_user_id',pg_temp.uid('admin'),'reason','self_appointed',
    'last_owner_user_id',pg_temp.uid('creator')), 'audit detail: '||event.detail::text;
  assert event.detail::text not like '%secret%' and event.detail::text not like '%CM-%',
    'the audit detail names no matter';
  -- Once named, the matter has an owner: a second appointment is refused.
  assert pg_temp.sqlstate_of(format('select public.assign_matter_owner(%L,%L,%L)',
    pg_temp.uid('owner'),vacant,pg_temp.uid('owner'))) = '55000', 'the new owner cannot be displaced either';

  -- The owner names a plain member on a matter with no team; the owner gains
  -- nothing, and there is no last owner to record.
  result := public.assign_matter_owner(pg_temp.uid('owner'),empty,pg_temp.uid('member'));
  assert result->>'owner_user_id' = pg_temp.uid('member')::text, 'owner names a member';
  assert pg_temp.team(empty) = 'member:matter_owner:active', 'the member owns the matter';
  select * into event from public.audit_events where action='matter.owner_assigned' and org_id=org
    and detail->>'matter_id' = empty::text;
  assert event.user_id = pg_temp.uid('owner') and event.detail->>'reason' = 'appointed'
    and event.detail ? 'last_owner_user_id' and event.detail->'last_owner_user_id' = 'null'::jsonb,
    'audit of an appointment with no previous owner: '||event.detail::text;
  assert (select count(*) from public.audit_events where action='matter.owner_assigned' and org_id=org) = 2,
    'one audit event per appointment';
end;
$$;

-- 3. Matters without an owner: owners and admins only, without titles.
do $$
declare
  org uuid := current_setting('litt.org')::uuid;
  ownerless uuid := current_setting('litt.ownerless')::uuid;
  listed jsonb;
begin
  assert (select array_agg(matter_id) from public.list_matters_without_owner(pg_temp.uid('admin'),org))
    = array[ownerless], 'the admin lists the matter without an owner';
  select to_jsonb(l) into listed from public.list_matters_without_owner(pg_temp.uid('owner'),org) l;
  assert (select array_agg(k order by k) from jsonb_object_keys(listed) k) = array['cm_number','created_at',
    'last_owner_display_name','last_owner_email','last_owner_user_id','matter_id','member_count','visibility'],
    'the list has no title column';
  assert listed::text not like '%secret%', 'the list names no matter';
  assert listed->>'cm_number' = 'CM-NONE' and (listed->>'member_count')::int = 1
    and listed->>'last_owner_user_id' is null, 'CM number, team size, no previous owner';
  assert pg_temp.sqlstate_of(format('select * from public.list_matters_without_owner(%L,%L)',
    pg_temp.uid('editor'),org)) = '42501', 'a member cannot list';
  assert pg_temp.sqlstate_of(format('select * from public.list_matters_without_owner(%L,%L)',
    pg_temp.uid('outsider'),org)) = 'P0002', 'another firm cannot list';
end;
$$;

-- 4. Privileges.
do $$
declare fn text;
begin
  foreach fn in array array['public.assign_matter_owner(uuid,uuid,uuid)',
    'public.list_matters_without_owner(uuid,uuid)'] loop
    assert not has_function_privilege('anon',fn,'execute'), fn||': anon';
    assert not has_function_privilege('authenticated',fn,'execute'), fn||': authenticated';
    assert has_function_privilege('service_role',fn,'execute'), fn||': service_role';
    assert (select prosecdef and proconfig @> array['search_path=public']
      from pg_proc where oid=fn::regprocedure), fn||': security definer, fixed search_path';
  end loop;
  -- Internal helpers run only inside the triggers and functions above.
  foreach fn in array array['public.apply_matter_team_project_access(uuid,uuid)',
    'public.matter_has_active_owner(uuid)'] loop
    assert not has_function_privilege('anon',fn,'execute')
      and not has_function_privilege('authenticated',fn,'execute')
      and not has_function_privilege('service_role',fn,'execute'), fn||': no direct callers';
  end loop;
end;
$$;
rollback;

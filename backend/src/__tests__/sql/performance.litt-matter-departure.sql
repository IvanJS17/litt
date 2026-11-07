-- Open product question (ledger §24, cycle 5; with W2 of cycle 3): who
-- reaches a matter's project after the member who created it leaves the
-- firm. This file pins today's behaviour; it does not decide it.
--
-- The departure trigger (cleanup_removed_org_member_overrides, branch
-- `if public.org_is_team`) clears user_id on every project the leaver
-- created, matter projects included. The matter exclusion (C2 point 3)
-- keeps a matter project out of the departure items, so it is neither
-- archived nor handed to the successor, and project_is_ownerless keeps it
-- away from the organization's owners.
--
--   * Matter B, project visibility 'organization' (the usual shape): the
--     matter team keeps it. The teammate is still an editor.
--   * Matter A, project visibility 'private' (W2): before the departure only
--     the creator reaches it. After it, nobody does: not the organization
--     owner, not an admin, not the matter teammate, not the successor, not
--     the former creator. The project is not deleted or archived; it stays
--     in the database, out of everyone's reach in the application.
--
-- Matter A conflicts with the owner's retention decision of 2026-10-24
-- ("work inside a firm's matters stays with the firm"). Changing the rule is
-- the owner's call; when it changes, update these assertions with it.
begin;
create temporary table litt_departure_actors(label text primary key, uid uuid);
do $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  successor uuid := gen_random_uuid(); teammate uuid := gen_random_uuid();
  creator uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); ma uuid; mb uuid;
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),
    (successor,successor||'@example.test'),(teammate,teammate||'@example.test'),
    (creator,creator||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',owner_id);
  insert into public.org_members(org_id,user_id,role) values
    (org,owner_id,'owner'),(org,admin_id,'admin'),(org,successor,'member'),
    (org,teammate,'member'),(org,creator,'member');
  insert into litt_departure_actors values
    ('owner',owner_id),('admin',admin_id),('successor',successor),
    ('teammate',teammate),('creator',creator);
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');
  insert into public.projects(id,user_id,org_id,name,visibility) values
    (pa,creator,org,'Matter A, private project','private'),
    (pb,creator,org,'Matter B, organization project','organization');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,pa,'Matter A','private') returning id into ma;
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,pb,'Matter B','private') returning id into mb;
  insert into public.matter_memberships(matter_id,user_id,role) values
    (ma,creator,'matter_owner'),(ma,teammate,'editor'),
    (mb,creator,'matter_owner'),(mb,teammate,'editor');
  perform set_config('litt.org',org::text,true);
  perform set_config('litt.pa',pa::text,true);
  perform set_config('litt.pb',pb::text,true);
  perform set_config('litt.creator',creator::text,true);
  -- The successor an owner picks in the departure dialog.
  perform set_config('mike.departure_successor',successor::text,true);
  perform set_config('mike.departure_actor',owner_id::text,true);
end;
$$;

-- reach(label, project): project_access_role verdict and project list.
create function pg_temp.reach(p_label text, p_project uuid) returns text language sql as $$
  select coalesce(public.project_access_role(p.id,p.user_id,p.org_id,a.uid::text,a.uid||'@example.test'),'none')
    ||'/'||case when exists(select 1 from public.project_list_access(a.uid::text,a.uid||'@example.test',null) l
      where l.project_id=p.id) then 'listed' else 'unlisted' end
  from litt_departure_actors a, public.projects p where a.label=p_label and p.id=p_project;
$$;

-- Before the departure.
do $$
declare pa uuid := current_setting('litt.pa')::uuid; pb uuid := current_setting('litt.pb')::uuid; a record;
begin
  for a in select label from litt_departure_actors loop
    assert pg_temp.reach(a.label,pa) = case a.label when 'creator' then 'owner/listed' else 'none/unlisted' end,
      format('before, matter A: %s reaches %s', a.label, pg_temp.reach(a.label,pa));
    assert pg_temp.reach(a.label,pb) = case a.label when 'creator' then 'owner/listed'
      when 'teammate' then 'editor/listed' else 'none/unlisted' end,
      format('before, matter B: %s reaches %s', a.label, pg_temp.reach(a.label,pb));
  end loop;
  assert not exists(select 1 from public.org_members_departure_items(current_setting('litt.org')::uuid,
    array[current_setting('litt.creator')::uuid]) where item_id in (pa,pb)),
    'neither matter project is a departure item (C2 point 3)';
end;
$$;

delete from public.org_members
  where org_id=current_setting('litt.org')::uuid and user_id=current_setting('litt.creator')::uuid;

-- After the departure.
do $$
declare
  org uuid := current_setting('litt.org')::uuid;
  pa uuid := current_setting('litt.pa')::uuid; pb uuid := current_setting('litt.pb')::uuid; a record;
begin
  -- Both projects are kept: creator cleared, not archived, not ownerless.
  assert (select count(*) from public.projects where id in (pa,pb)
    and user_id is null and archived_at is null and not public.project_is_ownerless(id,user_id,org_id)) = 2,
    'after: both matter projects are kept, creator cleared, not archived, not ownerless';
  assert not exists(select 1 from public.ownerless_org_item_ids(array[org]) where item_id in (pa,pb)),
    'after: no matter project is offered to the organization owner';
  for a in select label from litt_departure_actors loop
    -- Matter A: nobody reaches it any more.
    assert pg_temp.reach(a.label,pa) = 'none/unlisted',
      format('after, matter A: %s reaches %s', a.label, pg_temp.reach(a.label,pa));
    -- Matter B: the matter team keeps it.
    assert pg_temp.reach(a.label,pb) = case a.label when 'teammate' then 'editor/listed' else 'none/unlisted' end,
      format('after, matter B: %s reaches %s', a.label, pg_temp.reach(a.label,pb));
  end loop;
end;
$$;
rollback;

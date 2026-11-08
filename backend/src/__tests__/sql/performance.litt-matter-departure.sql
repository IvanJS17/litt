-- Who reaches a matter's project before and after the member who created it
-- and owned it leaves the firm (owner decisions of 2026-11-07, ledger §24.3
-- and §29.6 questions 1 and 2; migration 20261107_70_litt_matter_succession).
--
-- The departure trigger (cleanup_removed_org_member_overrides) still clears
-- user_id on every project the leaver created and keeps a matter project out
-- of the departure items (C2 point 3). The matter succession trigger then
-- revokes the leaver's matter memberships and, on a private matter left
-- without an active owner, promotes the teammate with the highest role
-- (editor before viewer, the earliest member on a tie) or, with no team
-- left, the successor chosen for the departure. The team reaches the
-- project with its matter roles whatever the project's visibility.
--
--   * Matter A, private matter, private project, team of four.
--   * Matter B, private matter, organization-visible project, team of two.
--   * Matter C, private matter, private project, only its creator.
--   * Matter D, public matter, private project, team of three (creator,
--     an older viewer, a newer editor): public matters keep their rules, so
--     the matter does not change. The private project follows the same
--     succession (owner decision of 2026-11-08, migration
--     20261108_10_litt_public_matter_project_succession): it passes to the
--     teammate with the highest matter role, the earliest on a tie, and the
--     creator's departure is the only trigger.
--   * Matter E, public matter, private project, only its creator: the
--     project passes to the successor chosen for the departure.
--   * Matter F, public matter, organization-visible project, and matter G,
--     public matter, private project created by a teammate: neither project
--     is the leaver's private one, so nobody's access to them changes.
--
-- Organization owners and admins never reach a private matter, or the
-- private project of a public one, by their role.
begin;
create temporary table litt_departure_actors(label text primary key, uid uuid);
do $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  successor uuid := gen_random_uuid(); teammate uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid(); editor2 uuid := gen_random_uuid();
  creator uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  pc uuid := gen_random_uuid(); pd uuid := gen_random_uuid();
  pe uuid := gen_random_uuid(); pf uuid := gen_random_uuid(); pg uuid := gen_random_uuid();
  ma uuid; mb uuid; mc uuid; md uuid; me uuid; mf uuid; mg uuid;
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),
    (successor,successor||'@example.test'),(teammate,teammate||'@example.test'),
    (viewer,viewer||'@example.test'),(editor2,editor2||'@example.test'),
    (creator,creator||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',owner_id);
  insert into public.org_members(org_id,user_id,role) values
    (org,owner_id,'owner'),(org,admin_id,'admin'),(org,successor,'member'),
    (org,teammate,'member'),(org,viewer,'member'),(org,editor2,'member'),
    (org,creator,'member');
  insert into litt_departure_actors values
    ('owner',owner_id),('admin',admin_id),('successor',successor),
    ('teammate',teammate),('viewer',viewer),('editor2',editor2),('creator',creator);
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');
  insert into public.projects(id,user_id,org_id,name,visibility) values
    (pa,creator,org,'Matter A, private project','private'),
    (pb,creator,org,'Matter B, organization project','organization'),
    (pc,creator,org,'Matter C, private project','private'),
    (pd,creator,org,'Matter D, private project','private'),
    (pe,creator,org,'Matter E, private project','private'),
    (pf,creator,org,'Matter F, organization project','organization'),
    (pg,teammate,org,'Matter G, private project of a teammate','private');
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pa,'Matter A','CM-A','private') returning id into ma;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pb,'Matter B','CM-B','private') returning id into mb;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pc,'Matter C','CM-C','private') returning id into mc;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pd,'Matter D','CM-D','public') returning id into md;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pe,'Matter E','CM-E','public') returning id into me;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pf,'Matter F','CM-F','public') returning id into mf;
  insert into public.matters(workspace_id,project_id,name,cm_number,visibility)
    values(ws,pg,'Matter G','CM-G','public') returning id into mg;
  -- Matter A: the viewer joined first, the teammate before editor2.
  insert into public.matter_memberships(matter_id,user_id,role,created_at) values
    (ma,creator,'matter_owner',now()-interval '4 days'),
    (ma,viewer,'viewer',now()-interval '3 days'),
    (ma,teammate,'editor',now()-interval '2 days'),
    (ma,editor2,'editor',now()-interval '1 day'),
    (mb,creator,'matter_owner',now()-interval '2 days'),
    (mb,teammate,'editor',now()-interval '1 day'),
    (mc,creator,'matter_owner',now()),
    (md,creator,'matter_owner',now()-interval '4 days'),
    (md,viewer,'viewer',now()-interval '3 days'),
    (md,teammate,'editor',now()),
    (me,creator,'matter_owner',now()),
    (mf,creator,'matter_owner',now()-interval '2 days'),
    (mf,teammate,'editor',now()),
    (mg,teammate,'matter_owner',now()-interval '2 days'),
    (mg,creator,'editor',now());
  perform set_config('litt.org',org::text,true);
  perform set_config('litt.owner',owner_id::text,true);
  perform set_config('litt.pa',pa::text,true);
  perform set_config('litt.pb',pb::text,true);
  perform set_config('litt.pc',pc::text,true);
  perform set_config('litt.pd',pd::text,true);
  perform set_config('litt.pe',pe::text,true);
  perform set_config('litt.pf',pf::text,true);
  perform set_config('litt.pg',pg::text,true);
  perform set_config('litt.ma',ma::text,true);
  perform set_config('litt.mb',mb::text,true);
  perform set_config('litt.mc',mc::text,true);
  perform set_config('litt.md',md::text,true);
  perform set_config('litt.me',me::text,true);
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

create temporary table litt_departure_before(label text, project text, reach text);

-- Before the departure: each team reaches its project with its matter role;
-- nobody else does.
do $$
declare
  pa uuid := current_setting('litt.pa')::uuid; pb uuid := current_setting('litt.pb')::uuid;
  pc uuid := current_setting('litt.pc')::uuid; pd uuid := current_setting('litt.pd')::uuid;
  pe uuid := current_setting('litt.pe')::uuid;
  a record;
begin
  for a in select label from litt_departure_actors loop
    assert pg_temp.reach(a.label,pa) = case a.label when 'creator' then 'owner/listed'
      when 'teammate' then 'editor/listed' when 'editor2' then 'editor/listed'
      when 'viewer' then 'viewer/listed' else 'none/unlisted' end,
      format('before, matter A: %s reaches %s', a.label, pg_temp.reach(a.label,pa));
    assert pg_temp.reach(a.label,pb) = case a.label when 'creator' then 'owner/listed'
      when 'teammate' then 'editor/listed' else 'none/unlisted' end,
      format('before, matter B: %s reaches %s', a.label, pg_temp.reach(a.label,pb));
    assert pg_temp.reach(a.label,pc) = case a.label when 'creator' then 'owner/listed' else 'none/unlisted' end,
      format('before, matter C: %s reaches %s', a.label, pg_temp.reach(a.label,pc));
    -- A public matter keeps its rules: its private project is its creator's.
    assert pg_temp.reach(a.label,pd) = case a.label when 'creator' then 'owner/listed' else 'none/unlisted' end,
      format('before, matter D: %s reaches %s', a.label, pg_temp.reach(a.label,pd));
    assert pg_temp.reach(a.label,pe) = case a.label when 'creator' then 'owner/listed' else 'none/unlisted' end,
      format('before, matter E: %s reaches %s', a.label, pg_temp.reach(a.label,pe));
    insert into litt_departure_before
      values(a.label,'F',pg_temp.reach(a.label,current_setting('litt.pf')::uuid)),
            (a.label,'G',pg_temp.reach(a.label,current_setting('litt.pg')::uuid));
  end loop;
  assert not exists(select 1 from public.org_members_departure_items(current_setting('litt.org')::uuid,
    array[current_setting('litt.creator')::uuid]) where item_id in (pa,pb,pc,pd)),
    'no matter project is a departure item (C2 point 3)';
end;
$$;

delete from public.org_members
  where org_id=current_setting('litt.org')::uuid and user_id=current_setting('litt.creator')::uuid;

-- After the departure.
do $$
declare
  org uuid := current_setting('litt.org')::uuid;
  creator uuid := current_setting('litt.creator')::uuid;
  pa uuid := current_setting('litt.pa')::uuid; pb uuid := current_setting('litt.pb')::uuid;
  pc uuid := current_setting('litt.pc')::uuid; pd uuid := current_setting('litt.pd')::uuid;
  pe uuid := current_setting('litt.pe')::uuid; pf uuid := current_setting('litt.pf')::uuid;
  pg uuid := current_setting('litt.pg')::uuid;
  ma uuid := current_setting('litt.ma')::uuid; mb uuid := current_setting('litt.mb')::uuid;
  mc uuid := current_setting('litt.mc')::uuid; md uuid := current_setting('litt.md')::uuid;
  me uuid := current_setting('litt.me')::uuid;
  a record; e record;
begin
  -- Every project is kept: creator cleared, not archived, not ownerless.
  assert (select count(*) from public.projects where id in (pa,pb,pc,pd,pe,pf)
    and user_id is null and archived_at is null and not public.project_is_ownerless(id,user_id,org_id)) = 6,
    'after: every matter project is kept, creator cleared, not archived, not ownerless';
  assert not exists(select 1 from public.ownerless_org_item_ids(array[org]) where item_id in (pa,pb,pc,pd,pe,pf)),
    'after: no matter project is offered to the organization owner';
  assert not exists(select 1 from public.matter_memberships where user_id=creator and status='active'),
    'after: the leaver holds no active matter membership';

  for a in select label from litt_departure_actors loop
    -- Matter A: the earlier of the two editors is the owner; the rest of the
    -- team keeps its roles.
    assert pg_temp.reach(a.label,pa) = case a.label when 'teammate' then 'owner/listed'
      when 'editor2' then 'editor/listed' when 'viewer' then 'viewer/listed' else 'none/unlisted' end,
      format('after, matter A: %s reaches %s', a.label, pg_temp.reach(a.label,pa));
    -- Matter B: its only teammate is the owner.
    assert pg_temp.reach(a.label,pb) = case a.label when 'teammate' then 'owner/listed' else 'none/unlisted' end,
      format('after, matter B: %s reaches %s', a.label, pg_temp.reach(a.label,pb));
    -- Matter C: no team left, so the departure's successor is the owner.
    assert pg_temp.reach(a.label,pc) = case a.label when 'successor' then 'owner/listed' else 'none/unlisted' end,
      format('after, matter C: %s reaches %s', a.label, pg_temp.reach(a.label,pc));
    -- Matter D (public): the private project passes to the teammate with
    -- the highest matter role (the editor, not the older viewer). The
    -- viewer, the organization owner and the admin gain nothing.
    assert pg_temp.reach(a.label,pd) = case a.label when 'teammate' then 'owner/listed' else 'none/unlisted' end,
      format('after, matter D: %s reaches %s', a.label, pg_temp.reach(a.label,pd));
    -- Matter E (public, no teammate left): the departure's successor.
    assert pg_temp.reach(a.label,pe) = case a.label when 'successor' then 'owner/listed' else 'none/unlisted' end,
      format('after, matter E: %s reaches %s', a.label, pg_temp.reach(a.label,pe));
    -- Matters F and G: not the leaver's private project, so nobody's access
    -- changes (the leaver's own access ended with the membership).
    if a.label <> 'creator' then
      assert pg_temp.reach(a.label,pf) = (select reach from litt_departure_before where label=a.label and project='F'),
        format('after, matter F: %s reaches %s', a.label, pg_temp.reach(a.label,pf));
      assert pg_temp.reach(a.label,pg) = (select reach from litt_departure_before where label=a.label and project='G'),
        format('after, matter G: %s reaches %s', a.label, pg_temp.reach(a.label,pg));
    end if;
  end loop;
  assert (select user_id from public.projects where id=pg) = (select uid from litt_departure_actors where label='teammate'),
    'after: matter G project keeps its creator';
  -- The project passes as an override owner; the matter itself is untouched.
  assert (select array_agg(l.label||':'||o.role order by l.label) from public.project_org_access_overrides o
    join litt_departure_actors l on l.uid=o.user_id where o.project_id in (pd,pe))
    = array['successor:owner','teammate:owner'], 'after: matter D and E projects pass to one owner each';
  assert not exists(select 1 from public.project_org_access_overrides o
    where o.project_id in (pd,pe) and (o.user_id = creator
      or o.user_id in (select uid from litt_departure_actors where label in ('owner','admin')))),
    'after: neither the leaver nor an organization owner or admin holds a public-matter project override';

  assert (select array_agg(l.label||':'||mm.role order by l.label) from public.matter_memberships mm
    join litt_departure_actors l on l.uid=mm.user_id where mm.matter_id=ma and mm.status='active')
    = array['editor2:editor','teammate:matter_owner','viewer:viewer'],
    'after: matter A team';
  assert (select array_agg(l.label||':'||mm.role order by l.label) from public.matter_memberships mm
    join litt_departure_actors l on l.uid=mm.user_id where mm.matter_id=mc and mm.status='active')
    = array['successor:matter_owner'], 'after: matter C team';
  assert (select array_agg(l.label||':'||mm.role order by l.label) from public.matter_memberships mm
    join litt_departure_actors l on l.uid=mm.user_id where mm.matter_id=md and mm.status='active')
    = array['teammate:editor','viewer:viewer'], 'after: matter D team is unchanged but for the leaver';
  assert (select count(*) from public.matter_memberships where matter_id in (md,me) and status='active'
    and role='matter_owner') = 0, 'after: succession does not make anyone owner of a public matter';

  -- One audit event per succession, with no title or content.
  assert (select count(*) from public.audit_events where action='matter.owner_succeeded' and org_id=org) = 3,
    'after: three successions are audited';
  for e in select * from public.audit_events where action='matter.owner_succeeded' and org_id=org loop
    assert e.user_id = current_setting('litt.owner')::uuid, 'succession actor is the departure actor';
    assert e.title is null and e.project_id is null, 'succession audit carries no title or project';
    assert (select array_agg(k order by k) from jsonb_object_keys(e.detail) k)
      = array['matter_id','org_id','reason','target_user_id'], 'succession audit detail keys';
    assert e.detail->>'org_id' = org::text, 'succession audit org';
    assert (e.detail->>'matter_id')::uuid in (ma,mb,mc), 'no succession on the public matter';
    assert e.detail->>'reason' = case (e.detail->>'matter_id')::uuid when mc then 'departure_successor'
      else 'team_member_promoted' end, 'succession reason';
    assert e.detail::text not like '%Matter %' and e.detail::text not like '%CM-%',
      'succession audit names no matter';
  end loop;

  -- Only public matters are left without an owner; the list has no title.
  assert (select array_agg(w.matter_id order by w.matter_id) from public.list_matters_without_owner(
    current_setting('litt.owner')::uuid, org) w where w.matter_id in (ma,mb,mc,md,me))
    = (select array_agg(x order by x) from unnest(array[md,me]) x),
    'after: only the public matters D and E are listed without an owner';
  assert (select w.last_owner_user_id = creator and w.member_count = 2 and w.cm_number = 'CM-D'
    from public.list_matters_without_owner(current_setting('litt.owner')::uuid, org) w where w.matter_id=md),
    'after: matter D shows its CM number, last owner and team size';
end;
$$;
rollback;

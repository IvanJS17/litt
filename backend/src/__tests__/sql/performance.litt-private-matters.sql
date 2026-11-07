-- LiTT C2 against upstream's cycle-3 list and permission rewrites (#749,
-- 20261030_*). Every function below was created or redefined by that
-- tranche. A project bound to a private matter must stay invisible to
-- everyone outside the matter's active team: the organization owner, an
-- organization admin, a member holding an editor override, and
-- an owner holding a recorded administrative opening. The team sees it.
--
--   project_list_access, get_projects_overview (all three overloads),
--   get_project_ids_overview, get_project_summaries, get_project_filter_options,
--   search_project_directory, review_list_access, get_tabular_reviews_overview,
--   get_tabular_review_ids_overview, find_document_text, document_text_access,
--   org_private_access_role, org_private_document_access,
--   organization_audit_events and org_members_departure_items (C2 point 3).
--
-- backend/src/__tests__/integration/littPrivateMatterLists.postgres.test.ts
-- also runs this file with the guard switched off and with upstream's
-- 20261030_04 alone, and expects it to fail: the assertions depend on LiTT's
-- guard, not on fixture luck.
begin;
create temporary table litt_matter_actors(label text primary key, uid uuid, email text, on_team boolean);
do $$
declare
  org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); teammate uuid := gen_random_uuid();
  creator uuid := gen_random_uuid();
  matter_project uuid := gen_random_uuid(); plain_project uuid := gen_random_uuid();
  matter uuid; doc uuid := gen_random_uuid(); version uuid := gen_random_uuid();
  review uuid := gen_random_uuid(); revision uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),
    (member_id,member_id||'@example.test'),(teammate,teammate||'@example.test'),
    (creator,creator||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Synthetic firm',owner_id);
  insert into public.org_members(org_id,user_id,role) values
    (org,owner_id,'owner'),(org,admin_id,'admin'),(org,member_id,'member'),
    (org,teammate,'member'),(org,creator,'member');
  insert into litt_matter_actors values
    ('owner',owner_id,owner_id||'@example.test',false),
    ('admin',admin_id,admin_id||'@example.test',false),
    ('member',member_id,member_id||'@example.test',false),
    ('teammate',teammate,teammate||'@example.test',true),
    ('creator',creator,creator||'@example.test',true);
  -- Organization visibility, an editor override and a recorded administrative
  -- opening: every upstream branch that could admit someone to an organization
  -- project (direct grants are refused for organization content).
  insert into public.projects(id,user_id,org_id,name,cm_number,practice,visibility) values
    (matter_project,creator,org,'Matter needle','CM-SECRET','Secret practice','organization'),
    (plain_project,creator,org,'Plain needle',null,'Open practice','private');
  insert into public.workspaces(id,organization_id,name) values(ws,org,'Synthetic workspace');
  insert into public.matters(workspace_id,project_id,name,visibility)
    values(ws,matter_project,'Private matter','private') returning id into matter;
  insert into public.matter_memberships(matter_id,user_id,role) values
    (matter,creator,'matter_owner'),(matter,teammate,'editor');
  insert into public.project_org_access_overrides(project_id,org_id,user_id,role)
    values(matter_project,org,member_id,'editor');
  -- Inserted directly: open_org_private_content refuses in LiTT.
  insert into public.org_private_content_access(org_id,user_id,kind,item_id)
    values(org,owner_id,'project',matter_project);
  insert into public.documents(id,project_id,org_id,user_id) values(doc,matter_project,org,creator);
  insert into public.document_versions(id,document_id,version_number,filename,text_revision)
    values(version,doc,1,'Matter needle.docx',revision);
  update public.documents set current_version_id=version where id=doc;
  insert into public.document_version_texts(version_id,source_revision,extractor_version,status,text_content)
    values(version,revision,1,'ready','The confidential needle clause.');
  insert into public.tabular_reviews(id,project_id,org_id,user_id,title)
    values(review,matter_project,org,creator,'Matter review');
  insert into public.audit_events(org_id,user_id,action,project_id,title)
    values(org,teammate,'project.updated',matter_project,'Matter needle');
  perform set_config('litt.org',org::text,true);
  perform set_config('litt.matter_project',matter_project::text,true);
  perform set_config('litt.plain_project',plain_project::text,true);
  perform set_config('litt.doc',doc::text,true);
  perform set_config('litt.review',review::text,true);
  perform set_config('litt.creator',creator::text,true);
end;
$$;

do $$
declare
  org uuid := current_setting('litt.org')::uuid;
  pm uuid := current_setting('litt.matter_project')::uuid;
  doc uuid := current_setting('litt.doc')::uuid;
  review uuid := current_setting('litt.review')::uuid;
  a record; ws text; sees boolean; result jsonb;
begin
  for a in select * from litt_matter_actors loop
    -- Oracle first: the per-project verdict carries the guard.
    assert (public.project_access_role(pm,(select user_id from public.projects where id=pm),org,a.uid::text,a.email) is not null) = a.on_team,
      format('%s: project_access_role', a.label);
    foreach ws in array array[null, org::text] loop
      sees := exists(select 1 from public.project_list_access(a.uid::text,a.email,ws) where project_id=pm);
      assert sees = a.on_team, format('%s/%s: project_list_access', a.label, ws);
      sees := exists(select 1 from public.get_projects_overview(a.uid::text,a.email,'all',100,0,null,'created','desc',null,null,ws) where id=pm);
      assert sees = a.on_team, format('%s/%s: get_projects_overview (paged)', a.label, ws);
      sees := exists(select 1 from public.get_projects_overview(a.uid::text,a.email,'all',100,0,null,'created','desc',null,null,ws,true) where id=pm);
      -- Participation narrows further (the teammate has not taken part yet).
      assert a.on_team or not sees, format('%s/%s: get_projects_overview (participating)', a.label, ws);
      sees := exists(select 1 from public.get_project_ids_overview(a.uid::text,a.email,'all',null,null,null,100,0,ws) where id=pm);
      assert sees = a.on_team, format('%s/%s: get_project_ids_overview', a.label, ws);
      sees := exists(select 1 from public.get_project_summaries(a.uid::text,a.email,100,0,ws) where id=pm);
      assert sees = a.on_team, format('%s/%s: get_project_summaries', a.label, ws);
      sees := exists(select 1 from public.get_project_filter_options(a.uid::text,a.email,ws) o where 'Secret practice' = any(o.practices));
      assert sees = a.on_team, format('%s/%s: get_project_filter_options', a.label, ws);
      result := public.search_project_directory(a.uid::text,a.email,'needle',100,0,ws);
      sees := exists(select 1 from jsonb_array_elements(result) p where p->>'id'=pm::text);
      assert sees = a.on_team, format('%s/%s: search_project_directory (name)', a.label, ws);
      result := public.search_project_directory(a.uid::text,a.email,'Matter needle.docx',100,0,ws);
      sees := exists(select 1 from jsonb_array_elements(result) p where p->>'id'=pm::text);
      assert sees = a.on_team, format('%s/%s: search_project_directory (filename)', a.label, ws);
      sees := exists(select 1 from public.review_list_access(a.uid::text,a.email,null,ws) where review_id=review);
      assert sees = a.on_team, format('%s/%s: review_list_access', a.label, ws);
      sees := exists(select 1 from public.get_tabular_reviews_overview(a.uid::text,a.email,null,'all',100,0,null,'created','desc',ws,null) where id=review);
      assert sees = a.on_team, format('%s/%s: get_tabular_reviews_overview', a.label, ws);
      sees := exists(select 1 from public.get_tabular_review_ids_overview(a.uid::text,a.email,null,'all',null,100,0,ws,null) where id=review);
      assert sees = a.on_team, format('%s/%s: get_tabular_review_ids_overview', a.label, ws);
    end loop;
    sees := exists(select 1 from public.get_projects_overview(a.uid::text,a.email) where id=pm);
    assert sees = a.on_team, format('%s: get_projects_overview (legacy)', a.label);
    sees := exists(select 1 from public.review_list_access(a.uid::text,a.email,pm::text,null) where review_id=review);
    assert sees = a.on_team, format('%s: review_list_access (requested project)', a.label);
    sees := exists(select 1 from public.get_tabular_reviews_overview(a.uid::text,a.email,pm::text,'all',100,0,null,'created','desc',null,null) where id=review);
    assert sees = a.on_team, format('%s: get_tabular_reviews_overview (requested project)', a.label);
    result := public.find_document_text(a.uid::text,a.email,org::text,'project','needle',pm);
    assert (jsonb_array_length(result->'matches') > 0) = a.on_team, format('%s: find_document_text (project)', a.label);
    result := public.find_document_text(a.uid::text,a.email,org::text,'document','needle',null,doc);
    assert (jsonb_array_length(result->'matches') > 0) = a.on_team, format('%s: find_document_text (document)', a.label);
    assert public.document_text_access(doc,a.uid::text,a.email) = a.on_team, format('%s: document_text_access', a.label);
    assert public.org_private_access_role(org,'project',pm,a.uid::text) is null, format('%s: org_private_access_role', a.label);
    assert not public.org_private_document_access(org,doc,a.uid::text), format('%s: org_private_document_access', a.label);
  end loop;

  -- The audit page shows the event to owners and admins, with the matter's
  -- title and project withheld from anyone outside the team.
  foreach ws in array array['owner','admin'] loop
    select to_jsonb(e) into result from litt_matter_actors x
      cross join lateral public.organization_audit_events(org,x.uid,x.email,null) e
      where x.label=ws and e.action='project.updated';
    assert result is not null, format('%s: audit event listed', ws);
    assert result->>'title' is null and result->>'project_id' is null, format('%s: organization_audit_events redacts the matter', ws);
  end loop;
end;
$$;

-- C2 point 3: a departing creator's matter project is not one of their
-- departure items (neither archived nor transferred); a plain private
-- project of theirs is.
do $$
declare
  org uuid := current_setting('litt.org')::uuid;
  creator uuid := current_setting('litt.creator')::uuid;
begin
  assert not exists(select 1 from public.org_members_departure_items(org,array[creator])
    where kind='project' and item_id=current_setting('litt.matter_project')::uuid),
    'org_members_departure_items: matter project stays with the matter team';
  assert exists(select 1 from public.org_members_departure_items(org,array[creator])
    where kind='project' and item_id=current_setting('litt.plain_project')::uuid),
    'org_members_departure_items: positive control';
end;
$$;
rollback;

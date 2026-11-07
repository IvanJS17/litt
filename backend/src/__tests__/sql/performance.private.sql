-- H2: one-item verdicts must never materialize the complete private catalogue.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
  doc uuid:=gen_random_uuid(); item record;
begin
  insert into auth.users(id,email) values(owner_id,owner_id||'@example.test'),(member_id,member_id||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Keyed private access',owner_id);
  insert into public.org_members(org_id,user_id,role) values(org,owner_id,'owner'),(org,member_id,'member');
  insert into public.documents(id,org_id,user_id) values(doc,org,member_id);
  insert into public.org_private_content_access(org_id,user_id,kind,item_id) values(org,owner_id,'document',doc);
  for item in select * from public.org_private_content_items(org) loop
    assert exists(select 1 from public.org_private_content_item(org,item.kind,item.item_id) p
      where p.title is not distinct from item.title and p.user_id is not distinct from item.user_id), 'keyed catalogue parity';
  end loop;
  perform set_config('mike.test_private_org',org::text,true);
  perform set_config('mike.test_private_owner',owner_id::text,true);
  perform set_config('mike.test_private_doc',doc::text,true);
end;
$$;
create or replace function public.org_private_content_items(p_org_id uuid)
returns table(kind text,item_id uuid,title text,user_id uuid) language plpgsql stable set search_path=public,pg_temp as $$
begin raise exception 'Single-item permission check expanded the whole catalogue'; end;
$$;
do $$
declare org uuid:=current_setting('mike.test_private_org')::uuid; actor text:=current_setting('mike.test_private_owner');
  doc uuid:=current_setting('mike.test_private_doc')::uuid;
begin
  -- LiTT C2: can_access_org_private_content is false, so a recorded opening
  -- grants nothing; the keyed lookup still never expands the catalogue.
  assert public.org_private_access_role(org,'document',doc,actor) is null, 'LiTT: keyed role grants nothing';
  assert not public.org_private_document_access(org,doc,actor), 'LiTT: keyed document role grants nothing';
  assert (select count(*)=0 from public.list_org_private_content_access(array[org],actor)), 'LiTT: no opened-item list';
  assert public.org_private_access_role(org,'document',doc,'not-a-uuid') is null, 'malformed actor remains denied';
  assert not has_function_privilege('authenticated','public.org_private_content_item(uuid,text,uuid)','EXECUTE'), 'helper is service-only';
end;
$$;
rollback;
-- Upstream exercises its owner/admin private-content feature here by
-- including orgs.privateContent.sql, orgs.auditPrivateContent.sql and
-- orgs.auditPagination.sql. LiTT does not have that feature (C2: no standing
-- owner/admin access to members' private content), those suites already fail
-- on LiTT main for that reason, and LiTT CI never ran them. LiTT asserts the
-- refusal instead.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
  doc uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(owner_id,owner_id||'@example.test'),(member_id,member_id||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Refused private access',owner_id);
  insert into public.org_members(org_id,user_id,role) values(org,owner_id,'owner'),(org,member_id,'member');
  insert into public.documents(id,org_id,user_id) values(doc,org,member_id);
  begin
    perform public.open_org_private_content(org,owner_id,'document',doc);
    raise exception 'LiTT: an organization owner opened a member''s private document';
  exception when insufficient_privilege then null;
  end;
  assert not exists(select 1 from public.org_private_content_access where org_id=org), 'LiTT: nothing recorded';
  assert not public.org_private_document_access(org,doc,owner_id::text), 'LiTT: owner has no document access';
end;
$$;
rollback;
-- S5 (LiTT adaptation): a document check is anchored on the document and
-- never expands an opened item's reference list. Upstream opens each item
-- through open_org_private_content; LiTT refuses that (C2: no owner/admin
-- access to members' private content), so the fixture writes the access rows
-- directly, as a stale record would look. Every verdict must stay false.
begin;
create function pg_temp.document_access_oracle(p_org_id uuid,p_document_id uuid,p_user_id text)
returns boolean language sql stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.documents d where d.id=p_document_id and d.org_id=p_org_id
    and d.archived_at is null and (
      public.org_private_access_role(p_org_id,'document',d.id,p_user_id) is not null
      or exists(select 1 from public.org_private_content_access a
        join public.org_private_content_item(p_org_id,a.kind,a.item_id) item on item.kind=a.kind and item.item_id=a.item_id
        join public.org_item_document_ids(a.kind,a.item_id) attached on attached.document_id=d.id
        where a.org_id=p_org_id and a.user_id=(case when p_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end)
          and public.can_access_org_private_content(p_org_id,a.user_id))
    ));
$$;
create temporary table private_doc_expected(org_id uuid,document_id uuid,actor text,allowed boolean);
do $$
declare owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
  project uuid:=gen_random_uuid(); project_chat uuid:=gen_random_uuid(); chat uuid:=gen_random_uuid(); closed_chat uuid:=gen_random_uuid();
  review uuid:=gen_random_uuid(); project_review uuid:=gen_random_uuid(); workflow uuid:=gen_random_uuid(); row_id uuid:=gen_random_uuid();
  d uuid[];
begin
  insert into auth.users(id,email) values(owner_id,owner_id||'@example.test'),(member_id,member_id||'@example.test');
  insert into public.organizations(id,name,created_by) values(org,'Anchored private documents',owner_id);
  insert into public.org_members(org_id,user_id,role) values(org,owner_id,'owner'),(org,member_id,'member');
  select array_agg(gen_random_uuid()) into d from generate_series(1,10);
  insert into public.projects(id,org_id,user_id,name,visibility) values(project,org,member_id,'Private matter','private');
  insert into public.workflows(id,org_id,user_id,title,type,visibility) values(workflow,org,member_id,'Private workflow','assistant','private');
  insert into public.documents(id,org_id,user_id,project_id,workflow_id) values
    (d[1],org,member_id,project,null),(d[2],org,member_id,null,workflow);
  insert into public.documents(id,org_id,user_id) select x,org,member_id from unnest(d[3:10]) x;
  update public.documents set archived_at=now() where id=d[10];
  insert into public.chats(id,org_id,user_id,project_id,title) values(project_chat,org,member_id,project,'Project chat'),
    (chat,org,member_id,null,'Private chat'),(closed_chat,org,member_id,null,'Not opened');
  insert into public.chat_messages(chat_id,role,files) values
    (project_chat,'user',jsonb_build_array(jsonb_build_object('document_id',d[3]::text))),
    (chat,'user',jsonb_build_array(jsonb_build_object('document_id',d[4]::text),jsonb_build_object('document_id',upper(d[9]::text)),jsonb_build_object('document_id',d[10]::text))),
    (closed_chat,'user',jsonb_build_array(jsonb_build_object('document_id',d[8]::text)));
  insert into public.tabular_reviews(id,org_id,user_id,project_id,title,document_ids) values
    (review,org,member_id,null,'Private review',jsonb_build_object(d[5]::text,true)),
    (project_review,org,member_id,project,'Project review',null);
  insert into public.tabular_review_rows(id,review_id,label,row_type,document_id) values(row_id,project_review,'Row','document',d[6]);
  insert into public.tabular_review_row_sources(row_id,document_id) values(row_id,d[7]);
  insert into public.org_private_content_access(org_id,user_id,kind,item_id) values(org,owner_id,'project',project);
  insert into public.org_private_content_access(org_id,user_id,kind,item_id) values(org,owner_id,'workflow',workflow);
  insert into public.org_private_content_access(org_id,user_id,kind,item_id) values(org,owner_id,'chat',chat);
  insert into public.org_private_content_access(org_id,user_id,kind,item_id) values(org,owner_id,'tabular_review',review);
  -- Many opened items with long histories: the old check expanded all of them.
  insert into public.chats(org_id,user_id,title) select org,member_id,'Opened '||n from generate_series(1,50) n;
  insert into public.chat_messages(chat_id,role,files) select c.id,'user',jsonb_build_array(jsonb_build_object('document_id',gen_random_uuid()::text))
    from public.chats c cross join generate_series(1,20) where c.title like 'Opened %';
  insert into public.org_private_content_access(org_id,user_id,kind,item_id) select org,owner_id,'chat',c.id from public.chats c where c.title like 'Opened %';
  insert into private_doc_expected select org,x,a,pg_temp.document_access_oracle(org,x,a)
    from unnest(d) x cross join unnest(array[owner_id::text,member_id::text,upper(owner_id::text),'not-a-uuid']) a;
  assert (select count(*) filter(where allowed) from private_doc_expected)=0,'LiTT: no document is reachable through recorded private access';
  assert (select count(*) from private_doc_expected)=40,'fixture: ten documents by four actors';
end;
$$;
create or replace function public.org_item_document_ids(p_kind text,p_item_id uuid)
returns table(document_id uuid) language plpgsql stable set search_path=public as $$
begin raise exception 'Document check expanded an opened item''s whole reference list'; end;
$$;
do $$
declare row record;
begin
  for row in select * from private_doc_expected loop
    assert public.org_private_document_access(row.org_id,row.document_id,row.actor) is not distinct from row.allowed,
      format('private document verdict changed for %s / %s',row.document_id,row.actor);
  end loop;
end;
$$;
rollback;

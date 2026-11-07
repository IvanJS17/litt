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

-- Disposable local PostgreSQL only. Assertions and fixtures always roll back.
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end; $$;
do $$
declare
  owner_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
  project uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
  doc uuid:=gen_random_uuid(); template uuid:=gen_random_uuid(); library_doc uuid:=gen_random_uuid();
  v1 uuid; v2 uuid; tv uuid; lv uuid; revision uuid; old_revision uuid; r jsonb; match jsonb;
begin
  insert into auth.users(id,email) values(owner_id,owner_id||'@example.test'),(reader_id,reader_id||'@example.test');
  insert into public.organizations(id,name,created_by,kind) values(org,'Search test',owner_id,'team');
  insert into public.org_members(org_id,user_id,role) values(org,owner_id,'owner'),(org,reader_id,'member');
  insert into public.projects(id,org_id,user_id,name) values(project,org,owner_id,'Search matter');
  insert into public.documents(id,org_id,project_id,user_id,status) values(doc,org,project,owner_id,'ready');
  insert into public.documents(id,user_id,status,library_kind) values(template,owner_id,'ready','template'),(library_doc,owner_id,'ready','file');
  v1:=(public.create_document_version(doc,'{"filename":"agreement.docx","storage_path":"old.docx","file_type":"docx"}',true)->>'id')::uuid;
  select text_revision into revision from document_versions where id=v1;
  perform pg_temp.assert_true((select count(*)=1 from db_jobs where kind='document.extract_text' and payload->>'versionId'=v1::text),'upload atomically schedules extraction');
  perform public.publish_document_text(v1,revision,'Historical assignment clause','hash',0);
  v2:=(public.create_document_version(doc,'{"filename":"agreement.docx","storage_path":"new.docx","file_type":"docx"}',true)->>'id')::uuid;
  select text_revision into revision from document_versions where id=v2;
  r:=public.find_document_text(owner_id::text,'',org::text,'project','assignment',project);
  perform pg_temp.assert_true((r#>>'{coverage,pending_versions}')::int=1 and jsonb_array_length(r->'matches')=0,'pending active version does not expose old text');
  perform public.publish_document_text(v2,revision,'😀 Consent requires 100% consent and a_b. Assignment permitted.','hash',0);
  r:=public.find_document_text(owner_id::text,'',org::text,'project','ASSIGNMENT',project);
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1 and r#>>'{matches,0,version_id}'=v2::text,'case insensitive current version search');
  match:=r#>'{matches,0}';
  perform pg_temp.assert_true(substring('😀 Consent requires 100% consent and a_b. Assignment permitted.' from (match->>'start_char')::int+1 for 10)='Assignment','Unicode offsets refer to original text');
  r:=public.find_document_text(owner_id::text,'',org::text,'document','Historical',null,doc,v1);
  perform pg_temp.assert_true(r#>>'{matches,0,version_id}'=v1::text,'historical version search is explicit');
  perform pg_temp.assert_true(public.read_document_text(owner_id::text,'',doc,v1)->>'text'='Historical assignment clause','historical read stays pinned');
  r:=public.find_document_text(owner_id::text,'','personal','project','Assignment',project);
  perform pg_temp.assert_true((r#>>'{coverage,total_versions}')::int=0,'workspace isolation covers counts');
  r:=public.find_document_text(reader_id::text,'',org::text,'project','Assignment',project);
  perform pg_temp.assert_true((r#>>'{coverage,total_versions}')::int=0,'private project hides text and counts');
  insert into public.project_org_access_overrides(project_id,org_id,user_id,role) values(project,org,reader_id,'viewer');
  r:=public.find_document_text(reader_id::text,'',org::text,'project','Assignment',project);
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1,'shared project viewer can find text');
  update project_org_access_overrides set role='deny' where project_id=project and user_id=reader_id;
  perform pg_temp.assert_true(public.read_document_text(reader_id::text,'',doc,v2) is null,'revocation between search and read denies content');
  r:=public.find_document_text(owner_id::text,'',org::text,'project','100%',project);
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1,'percent is literal');
  r:=public.find_document_text(owner_id::text,'',org::text,'project','a_b',project);
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1,'underscore is literal');
  r:=public.find_document_text(owner_id::text,'',org::text,'project','.*',project);
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=0,'regex metacharacters are literal');
  old_revision:=revision;
  update document_versions set filename='renamed.docx',pdf_storage_path='rendition.pdf' where id=v2;
  perform pg_temp.assert_true((select text_revision=old_revision from document_versions where id=v2),'metadata/rendition changes preserve text');
  update document_versions set storage_path='edited.docx',content_sha256='new-hash' where id=v2;
  select text_revision into revision from document_versions where id=v2;
  perform pg_temp.assert_true(revision<>old_revision,'content edit creates a new revision');
  perform pg_temp.assert_true(not public.publish_document_text(v2,old_revision,'Obsolete assignment','hash',0),'late old writer cannot publish');
  perform pg_temp.assert_true((select text_content is null and status='pending' from document_version_texts where version_id=v2),'edit invalidates old text immediately');
  perform public.publish_document_text(v2,revision,'Updated consent','new-hash',0);
  r:=public.find_document_text(owner_id::text,'',org::text,'project','Assignment',project);
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=0,'old text disappears after edit');
  perform pg_temp.assert_true(public.read_document_text(owner_id::text,'',doc,v1)->>'text'='Historical assignment clause','editing current preserves history');
  tv:=(public.create_document_version(template,'{"filename":"template.docx","storage_path":"template.docx","file_type":"docx"}',true)->>'id')::uuid;
  lv:=(public.create_document_version(library_doc,'{"filename":"file.pdf","storage_path":"file.pdf","file_type":"pdf"}',true)->>'id')::uuid;
  select text_revision into revision from document_versions where id=tv;
  perform public.publish_document_text(tv,revision,'Library consent','hash',0);
  select text_revision into revision from document_versions where id=lv;
  perform public.publish_document_text(lv,revision,'Library consent','hash',2);
  r:=public.find_document_text(owner_id::text,'','personal','templates','consent');
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1 and r#>>'{matches,0,document_id}'=template::text,'template scope is separate');
  r:=public.find_document_text(owner_id::text,'','personal','library','consent');
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1 and (r#>>'{coverage,versions_needing_ocr}')::int=1,'library scope reports OCR gaps');
  r:=public.find_document_text(reader_id::text,'','personal','templates','consent');
  perform pg_temp.assert_true((r#>>'{coverage,total_versions}')::int=0,'another user cannot search library templates');
  perform pg_temp.assert_true(public.read_document_text(owner_id::text,'',template,lv) is null,'version must belong to requested document');
  update documents set archived_at=now() where id=library_doc;
  perform pg_temp.assert_true(public.read_document_text(owner_id::text,'',library_doc,lv) is null,'archived document cannot be read');
  update document_versions set deleted_at=now() where id=v1;
  perform pg_temp.assert_true(not exists(select 1 from document_version_texts where version_id=v1),'soft deletion removes stored text');
  perform pg_temp.assert_true(not public.publish_document_text(v1,old_revision,'deleted bytes','hash',0),'deleted version cannot be repopulated');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.document_version_texts','select'),'text table is server-only');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.find_document_text(text,text,text,text,text,uuid,uuid,uuid,integer,integer)','execute'),'caller cannot spoof server actor');
end;
$$;
rollback;
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end; $$;
do $$
declare actor uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); v1 uuid; v2 uuid; revision uuid; r jsonb;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.test');
  insert into documents(id,user_id,status) values(doc,actor,'ready');
  alter table document_versions disable trigger document_text_changed;
  v1:=(public.create_document_version(doc,'{"filename":"one.docx","storage_path":"one.docx","file_type":"docx"}',true)->>'id')::uuid;
  v2:=(public.create_document_version(doc,'{"filename":"two.docx","storage_path":"two.docx","file_type":"docx"}',true)->>'id')::uuid;
  alter table document_versions enable trigger document_text_changed;
  perform set_config('mike.backfill_doc',doc::text,true);
  perform set_config('mike.backfill_actor',actor::text,true);
  perform set_config('mike.backfill_v1',v1::text,true);
  perform set_config('mike.backfill_v2',v2::text,true);
end;
$$;
-- Versions from before text search have no text row. The upgrade that made
-- the sweep start from unfinished rows records them as pending first.
\ir ../../../../migrations/20261101_23_document_text_backfill_from_unfinished.sql
do $$
declare actor uuid:=current_setting('mike.backfill_actor')::uuid; v1 uuid:=current_setting('mike.backfill_v1')::uuid;
  v2 uuid:=current_setting('mike.backfill_v2')::uuid; revision uuid; r jsonb;
begin
  perform pg_temp.assert_true(public.backfill_document_text(1,false)=1,'bounded first batch');
  perform pg_temp.assert_true(exists(select 1 from db_jobs where dedupe_key like 'document.text:'||v2||':%')
    and not exists(select 1 from db_jobs where dedupe_key like 'document.text:'||v1||':%'),'current versions prioritized');
  perform pg_temp.assert_true(public.backfill_document_text(1,false)=1,'resumes into history');
  perform pg_temp.assert_true(public.backfill_document_text(1,false)=0,'live jobs deduplicated');
  update document_version_texts set status='failed',error_code='extraction_failed' where version_id=v2;
  update db_jobs set status='failed' where kind='document.extract_text' and payload->>'versionId'=v2::text;
  perform pg_temp.assert_true(public.backfill_document_text(10,false)=0,'failed extraction does not loop forever');
  r:=public.find_document_text(actor::text,'','personal','library','word');
  perform pg_temp.assert_true((r#>>'{coverage,failed_versions}')::int=1,'failure coverage survives job retention');
  perform pg_temp.assert_true(public.backfill_document_text(10,true)=1,'explicit retries repair failed extraction');
  select text_revision into revision from document_versions where id=v2;
  perform public.publish_document_text(v2,revision,'','hash',0);
  perform pg_temp.assert_true((select status='ready' and text_content='' from document_version_texts where version_id=v2),'empty success differs from missing extraction');
  perform pg_temp.assert_true(public.backfill_document_text(10,true)=0,'ready empty documents are never re-extracted');
end;
$$;
rollback;

-- A stored text leaves the database in bounded slices only, and a search scans in bounded pieces under a time budget.
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end; $$;
do $$
declare actor uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); v uuid; revision uuid;
  r jsonb; part jsonb; whole text:=''; chunk text; k int; filler text; txt text; t0 timestamptz; piece int:=65536;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.test'),(other,other||'@example.test');
  insert into documents(id,user_id,status,library_kind) values(doc,actor,'ready','file');
  v:=(public.create_document_version(doc,'{"filename":"long.docx","storage_path":"long.docx","file_type":"docx"}',true)->>'id')::uuid;
  select text_revision into revision from document_versions where id=v;
  txt:=repeat('é',700000)||'😀'||repeat('z',500001);
  perform public.publish_document_text(v,revision,txt,'hash',1);
  update documents set current_version_id=v where id=doc;

  -- Whatever the caller asks, one answer carries at most 500,000 characters.
  r:=public.read_document_text(actor::text,'',doc,v);
  perform pg_temp.assert_true(char_length(r->>'text')<=500000,'default read is one bounded slice');
  perform pg_temp.assert_true((r->>'text_length')::int=char_length(txt),'the answer states the whole length');
  perform pg_temp.assert_true(r->>'status'='ready' and (r->>'textless_page_count')::int=1 and r->>'revision'=revision::text,'status, revision and scan count are unchanged');
  r:=public.read_document_text(actor::text,'',doc,v,0,2000000000);
  perform pg_temp.assert_true(char_length(r->>'text')=500000,'a huge request is cut to the bound');
  r:=public.read_document_text(actor::text,'',doc,v,-5,10);
  perform pg_temp.assert_true(r->>'text'=repeat('é',10),'a negative offset reads from the start');
  r:=public.read_document_text(actor::text,'',doc,v,char_length(txt)+10,100);
  perform pg_temp.assert_true(r->>'text'='' and (r->>'text_length')::int=char_length(txt),'past the end reads nothing');
  -- slices put back together are the stored text, multi-byte characters included at the boundary
  k:=0;
  while k<char_length(txt) loop
    part:=public.read_document_text(actor::text,'',doc,v,k,500000);
    whole:=whole||(part->>'text'); k:=k+500000;
  end loop;
  perform pg_temp.assert_true(whole=txt,'slices reassemble to the stored text');
  perform pg_temp.assert_true(public.read_document_text(other::text,'',doc,v) is null,'access is still checked first');
  -- the trusted slice (no actor) is bounded the same way and is for the server role only
  perform pg_temp.assert_true(char_length(public.document_text_slice(v,revision,0,2000000000)->>'text')=500000,'trusted slice is bounded');
  perform pg_temp.assert_true(public.document_text_slice(v,gen_random_uuid(),0,10)->>'text' is null,'trusted slice is keyed to the revision');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.document_text_slice(uuid,uuid,integer,integer)','execute')
    and has_function_privilege('service_role','public.document_text_slice(uuid,uuid,integer,integer)','execute'),'trusted slice is server-only');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.read_document_text(text,text,uuid,uuid,integer,integer)','execute'),'read is server-only');

  -- A match that straddles two scanned pieces is found, with the same offsets, whatever the character width.
  foreach filler in array array['a','é','😀'] loop
    for k in 0..12 loop
      txt:=repeat(filler,piece-6+k)||'Clause Target'||repeat(filler,20);
      perform public.publish_document_text(v,revision,txt,'hash',0);
      r:=public.find_document_text(actor::text,'','personal','library','cLAUSE tARGET');
      perform pg_temp.assert_true(jsonb_array_length(r->'matches')=1 and (r#>>'{matches,0,start_char}')::int=piece-6+k
        and (r#>>'{matches,0,end_char}')::int=piece-6+k+13
        and (r#>>'{matches,0,excerpt_start_char}')::int=greatest(piece-6+k-160,0)
        and substring(txt from (r#>>'{matches,0,excerpt_start_char}')::int+1 for 5000) like r#>>'{matches,0,excerpt}'||'%'
        and r#>>'{matches,0,excerpt}' like '%Clause Target%',format('straddling match with %s at %s',filler,k));
      perform pg_temp.assert_true((r#>>'{coverage,search_incomplete}')='false','a finished search says so');
    end loop;
  end loop;
  -- exactly at the end of a piece, a text of exactly one piece, empty text, and no match
  txt:=repeat('a',piece-6)||'needle'; perform public.publish_document_text(v,revision,txt,'hash',0);
  r:=public.find_document_text(actor::text,'','personal','library','needle');
  perform pg_temp.assert_true((r#>>'{matches,0,start_char}')::int=piece-6,'match ending at the end of a piece');
  txt:=''; perform public.publish_document_text(v,revision,txt,'hash',0);
  r:=public.find_document_text(actor::text,'','personal','library','needle');
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=0 and (r#>>'{coverage,indexed_versions}')::int=1 and (r#>>'{coverage,search_incomplete}')='false','empty text: no match, not incomplete');
  txt:=repeat('ab',3*piece); perform public.publish_document_text(v,revision,txt,'hash',0);
  r:=public.find_document_text(actor::text,'','personal','library','abba');
  perform pg_temp.assert_true(jsonb_array_length(r->'matches')=0,'no match when there is none');

  -- A time budget stops a search INSIDE a large text, and says the answer is incomplete.
  -- The phrase makes every piece slow to scan, so on any machine it is the budget that ends the search.
  txt:=repeat('a',6*1048576); perform public.publish_document_text(v,revision,txt,'hash',0);
  perform set_config('litt.text_search_budget_ms','50',true);
  t0:=clock_timestamp();
  r:=public.find_document_text(actor::text,'','personal','library','b'||repeat('a',499));
  perform pg_temp.assert_true((r#>>'{coverage,search_incomplete}')='true' and jsonb_array_length(r->'matches')=0 and r->'next_offset'='null'::jsonb,'a stopped search is reported incomplete');
  perform pg_temp.assert_true(clock_timestamp()-t0<interval '1500 milliseconds','the budget stops the scan inside one text');
  perform set_config('litt.text_search_budget_ms','','true');
end;
$$;
rollback;

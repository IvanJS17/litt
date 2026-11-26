-- Migration date: 2026-11-26
-- Reading and searching the stored text of a document costs a bounded amount,
-- whatever the document.
--
-- read_document_text returned the whole text as one JSON value (a stored text
-- of 16 MiB can be about 50 MiB of JSON). It now returns one slice: at most
-- 500,000 characters (a few MiB of JSON even for control characters, which
-- JSON writes as six bytes), whatever the caller asks, with the length of the
-- whole text so the caller can ask for the next slice. document_text_slice is
-- the same slice for the server's own reads that were already authorized.
--
-- find_document_text keeps its signature, its eligibility and access rules and
-- its answer shape. It no longer runs `like` over every whole text. It scans
-- each ready text in pieces of 64 KiB (with an overlap of the phrase's length,
-- so a match across two pieces is found), checks the clock between pieces and
-- stops when a 3 second budget is spent. coverage.search_incomplete says so:
-- an incomplete search is never a silent "no matches". The setting
-- litt.text_search_budget_ms can only shorten the budget (tests use it).
drop function if exists public.read_document_text(text,text,uuid,uuid);

create or replace function public.read_document_text(p_user_id text,p_user_email text,p_document_id uuid,p_version_id uuid,
  p_offset integer default 0,p_length integer default 500000)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('revision',v.text_revision,'status',coalesce(t.status,'pending'),
    'text',substring(t.text_content from greatest(coalesce(p_offset,0),0)+1 for least(greatest(coalesce(p_length,500000),0),500000)),
    'text_length',char_length(t.text_content),'textless_page_count',t.textless_page_count)
  from public.document_versions v left join public.document_version_texts t
    on t.version_id=v.id and t.source_revision=v.text_revision and t.extractor_version=1
  where v.id=p_version_id and v.document_id=p_document_id and v.deleted_at is null
    and public.document_text_access(p_document_id,p_user_id,p_user_email);
$$;

-- For reads the server has already authorized (the version's own revision and
-- ready text): the same bounded slice, without the actor.
create or replace function public.document_text_slice(p_version_id uuid,p_source_revision uuid,
  p_offset integer default 0,p_length integer default 500000)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'text',substring(t.text_content from greatest(coalesce(p_offset,0),0)+1 for least(greatest(coalesce(p_length,500000),0),500000)),
    'text_length',char_length(t.text_content))
  from public.document_version_texts t
  where t.version_id=p_version_id and t.source_revision=p_source_revision and t.extractor_version=1 and t.status='ready';
$$;

create or replace function public.find_document_text(
  p_user_id text,p_user_email text,p_workspace text,p_scope text,p_query text,
  p_project_id uuid default null,p_document_id uuid default null,p_version_id uuid default null,
  p_limit integer default 10,p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb; project_allowed boolean; page_limit integer:=least(greatest(coalesce(p_limit,10),1),20);
  cov jsonb; elig jsonb; el jsonb; hits jsonb:='[]'::jsonb; found_n integer:=0; seen integer:=0; stopped boolean:=false;
  blob bytea; nbytes integer; b0 integer; b1 integer; w1 integer; chars_before integer; hit_at integer;
  needle text:=lower(p_query); needle_len integer:=char_length(lower(p_query));
  piece constant integer:=65536;
  budget_ms integer:=least(greatest(coalesce(nullif(current_setting('litt.text_search_budget_ms',true),'')::integer,3000),0),3000);
  deadline timestamptz;
begin
  if p_scope is null or p_scope not in ('project','library','templates','document') or p_query is null
    or char_length(trim(p_query))<2 or char_length(p_query)>500
    or p_offset is null or p_offset<0 or p_offset>100000
    or (p_scope='project' and p_project_id is null)
    or (p_scope='document' and p_document_id is null)
    or (p_version_id is not null and p_scope<>'document') then
    raise exception 'Invalid document search' using errcode='22023';
  end if;
  deadline:=clock_timestamp()+make_interval(secs=>budget_ms/1000.0);
  if p_scope='project' then
    select public.project_access_role(p.id,p.user_id,p.org_id,p_user_id,p_user_email) is not null
      into project_allowed from public.projects p where p.id=p_project_id;
  end if;
  with eligible as materialized (
    select d.id document_id,d.library_kind,v.id version_id,v.version_number,v.filename,v.file_type,
      v.storage_path,v.text_revision
    from public.documents d join public.document_versions v on v.document_id=d.id
    where d.archived_at is null and v.deleted_at is null
      and (case when p_version_id is null then v.id=d.current_version_id else v.id=p_version_id end)
      and (case when coalesce(p_workspace,'personal')='personal' then d.org_id is null else d.org_id=p_workspace::uuid end)
      and case p_scope
        when 'project' then d.project_id=p_project_id
        when 'library' then d.project_id is null and d.workflow_id is null and d.library_kind='file' and d.user_id=(case when p_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end)
        when 'templates' then d.project_id is null and d.workflow_id is null and d.library_kind='template' and d.user_id=(case when p_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end)
        when 'document' then d.id=p_document_id
        else false end
      and case when p_scope='project' then coalesce(project_allowed,false) and public.org_is_active(d.org_id)
        else public.document_text_access(d.id,p_user_id,p_user_email) end
  ), coverage as (
    select count(*) total_versions,
      count(*) filter(where t.status='ready') indexed_versions,
      count(*) filter(where t.status='failed') failed_versions,
      count(*) filter(where t.status is null or t.status in ('pending','processing')) pending_versions,
      count(*) filter(where t.status='ready' and t.textless_page_count>0) versions_needing_ocr
    -- Each eligible version's text is one primary-key probe (OFFSET 0 keeps
    -- the subquery from being flattened). Joined freely, a reused generic
    -- plan scanned the text table, or its trigram index, across all tenants.
    from eligible e left join lateral (
      select item.status,item.textless_page_count from public.document_version_texts item
      where item.version_id=e.version_id and item.source_revision=e.text_revision and item.extractor_version=1
      offset 0
    ) t on true
  )
  select (select to_jsonb(coverage) from coverage),
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.document_id,e.version_id),'[]'::jsonb) from eligible e)
    into cov, elig;

  -- The text of each eligible version is scanned in pieces of 64 KiB, each
  -- extended by the phrase's length so a match across two pieces is found, and
  -- the clock is checked between pieces: the cost of a search is bounded
  -- whatever the stored text and the phrase.
  for el in select value from jsonb_array_elements(elig) loop
    exit when stopped or found_n>page_limit;
    if clock_timestamp()>deadline then stopped:=true; exit; end if;
    select convert_to(item.text_content,'UTF8') into blob from public.document_version_texts item
      where item.version_id=(el->>'version_id')::uuid and item.source_revision=(el->>'text_revision')::uuid
        and item.status='ready' and item.extractor_version=1;
    if not found or blob is null then continue; end if;
    nbytes:=octet_length(blob); b0:=0; chars_before:=0; hit_at:=null;
    while b0<nbytes loop
      if clock_timestamp()>deadline then stopped:=true; exit; end if;
      b1:=least(b0+piece,nbytes);
      while b1<nbytes and (get_byte(blob,b1)&192)=128 loop b1:=b1+1; end loop;
      w1:=least(b1+4*needle_len,nbytes);
      while w1<nbytes and (get_byte(blob,w1)&192)=128 loop w1:=w1+1; end loop;
      hit_at:=strpos(lower(convert_from(substring(blob from b0+1 for w1-b0),'UTF8')),needle);
      if hit_at>0 then hit_at:=chars_before+hit_at; exit; end if;
      hit_at:=null;
      chars_before:=chars_before+char_length(convert_from(substring(blob from b0+1 for b1-b0),'UTF8'));
      b0:=b1;
    end loop;
    if hit_at is not null then
      seen:=seen+1;
      if seen>p_offset then
        hits:=hits||jsonb_build_array(el||jsonb_build_object('pos',hit_at));
        found_n:=found_n+1;
      end if;
    end if;
  end loop;

  select jsonb_build_object('coverage',cov||jsonb_build_object('search_incomplete',stopped),
    'next_offset',case when found_n>page_limit then p_offset+page_limit else null end,
    'matches',coalesce((select jsonb_agg(jsonb_build_object(
      'document_id',m.value->>'document_id','version_id',m.value->>'version_id',
      'version_number',m.value->'version_number','revision',m.value->>'text_revision',
      'filename',m.value->>'filename','file_type',m.value->>'file_type','storage_path',m.value->>'storage_path',
      'library_kind',m.value->>'library_kind','start_char',(m.value->>'pos')::integer-1,
      'end_char',(m.value->>'pos')::integer-1+char_length(p_query),
      'excerpt_start_char',greatest((m.value->>'pos')::integer-161,0),
      'excerpt',(select substring(item.text_content from greatest((m.value->>'pos')::integer-160,1) for char_length(p_query)+320)
        from public.document_version_texts item where item.version_id=(m.value->>'version_id')::uuid
          and item.source_revision=(m.value->>'text_revision')::uuid)
    ) order by m.ordinality) from jsonb_array_elements(hits) with ordinality m where m.ordinality<=page_limit),'[]'::jsonb)) into result;
  return result;
end;
$$;

revoke all on function public.read_document_text(text,text,uuid,uuid,integer,integer),
  public.document_text_slice(uuid,uuid,integer,integer),
  public.find_document_text(text,text,text,text,text,uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.read_document_text(text,text,uuid,uuid,integer,integer),
  public.document_text_slice(uuid,uuid,integer,integer),
  public.find_document_text(text,text,text,text,text,uuid,uuid,uuid,integer,integer) to service_role;

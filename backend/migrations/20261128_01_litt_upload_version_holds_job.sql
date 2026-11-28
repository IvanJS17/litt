-- Migration date: 2026-11-28
--
-- An upload attempt writes its document version only while it still holds its
-- job. The proof that the job is held and the write of the version are one
-- transaction: the job row is locked until the version commits, so whatever
-- ends the job afterwards waits for that commit and the cleanup that follows
-- sees the version's objects.
--
-- Two service-role-only functions, next to create_document_version, which is
-- unchanged for its other callers:
--   - create_document_version_for_upload_job: the job check, then
--     create_document_version;
--   - replace_document_version_for_upload_job: the job check, then the
--     conditional in-place replacement of one live version (an already sealed
--     version is not changed; no row updated returns null).
-- A job that is not running, or is held by another worker, or does not exist,
-- raises upload_job_not_held (SQLSTATE 55000) and writes nothing.
-- Lock order: the job row first, then the document row.
--
-- Only adds functions. Safe to re-run: create or replace, grants repeated.

create or replace function public.create_document_version_for_upload_job(
  p_job_id uuid, p_worker_id text,
  p_document_id uuid, p_version jsonb, p_activate boolean default true
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.upload_processing_jobs
    where id = p_job_id and status = 'running' and locked_by = p_worker_id
    for update;
  if not found then raise exception 'upload_job_not_held' using errcode = '55000'; end if;
  return public.create_document_version(p_document_id, p_version, p_activate);
end;
$$;
revoke all on function public.create_document_version_for_upload_job(uuid, text, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.create_document_version_for_upload_job(uuid, text, uuid, jsonb, boolean) to service_role;

-- p_patch names the columns to set (a key with a JSON null sets null; a key
-- that is not one of the columns below is refused);
-- p_expect names values the row must still have: storage_path, content_sha256.
create or replace function public.replace_document_version_for_upload_job(
  p_job_id uuid, p_worker_id text,
  p_document_id uuid, p_version_id uuid, p_patch jsonb, p_expect jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.document_versions%rowtype;
begin
  perform 1 from public.upload_processing_jobs
    where id = p_job_id and status = 'running' and locked_by = p_worker_id
    for update;
  if not found then raise exception 'upload_job_not_held' using errcode = '55000'; end if;
  -- A column this function does not set is refused, never silently dropped.
  if exists (
    select 1 from jsonb_object_keys(p_patch) as k
    where k not in (
      'storage_path', 'pdf_storage_path', 'filename', 'file_type', 'size_bytes', 'page_count',
      'textless_page_count', 'content_sha256', 'created_at', 'training_author_user_id', 'training_stage'
    )
  ) then
    raise exception 'unsupported_version_field' using errcode = '22023';
  end if;
  update public.document_versions set
    storage_path = case when p_patch ? 'storage_path' then p_patch->>'storage_path' else storage_path end,
    pdf_storage_path = case when p_patch ? 'pdf_storage_path' then p_patch->>'pdf_storage_path' else pdf_storage_path end,
    filename = case when p_patch ? 'filename' then p_patch->>'filename' else filename end,
    file_type = case when p_patch ? 'file_type' then p_patch->>'file_type' else file_type end,
    size_bytes = case when p_patch ? 'size_bytes' then (p_patch->>'size_bytes')::integer else size_bytes end,
    page_count = case when p_patch ? 'page_count' then (p_patch->>'page_count')::integer else page_count end,
    textless_page_count = case when p_patch ? 'textless_page_count' then (p_patch->>'textless_page_count')::integer else textless_page_count end,
    content_sha256 = case when p_patch ? 'content_sha256' then p_patch->>'content_sha256' else content_sha256 end,
    created_at = case when p_patch ? 'created_at' then (p_patch->>'created_at')::timestamptz else created_at end,
    training_author_user_id = case when p_patch ? 'training_author_user_id' then (p_patch->>'training_author_user_id')::uuid else training_author_user_id end,
    training_stage = case when p_patch ? 'training_stage' then p_patch->>'training_stage' else training_stage end
  where id = p_version_id
    and document_id = p_document_id
    and deleted_at is null
    and (not (p_patch ? 'storage_path' or p_patch ? 'content_sha256') or training_stage is null)
    and (not (p_expect ? 'storage_path') or storage_path is not distinct from p_expect->>'storage_path')
    and (not (p_expect ? 'content_sha256') or content_sha256 is not distinct from p_expect->>'content_sha256')
  returning * into v_row;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_row.id, 'version_number', v_row.version_number, 'source', v_row.source,
    'created_at', v_row.created_at, 'filename', v_row.filename, 'file_type', v_row.file_type,
    'size_bytes', v_row.size_bytes, 'page_count', v_row.page_count,
    'textless_page_count', v_row.textless_page_count
  );
end;
$$;
revoke all on function public.replace_document_version_for_upload_job(uuid, text, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_document_version_for_upload_job(uuid, text, uuid, uuid, jsonb, jsonb) to service_role;

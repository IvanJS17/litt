-- Migration date: 2026-11-26
-- Storage quota, part 1: opening an upload session is refused when the space
-- (a firm, or a personal space) is full.

-- The space (a firm, or a person's personal space) an open session reserves
-- its bytes in. No foreign keys: a session is short-lived bookkeeping and must
-- never block deleting a firm or an account.
alter table public.upload_sessions
  add column if not exists quota_org_id uuid,
  add column if not exists quota_user_id uuid;

create index if not exists upload_sessions_quota_open_idx
  on public.upload_sessions(quota_org_id, quota_user_id)
  where status in ('pending_upload', 'verifying', 'uploaded', 'processing');

-- Storage quota: how much a space uses and what its limit is. One answer for
-- the check that opens an upload session and for anything that shows usage.
--
-- A firm's space is the documents filed under the organization; its limit is
-- the per-member value times the rows of org_members (pending invitations are
-- not rows). A personal space is the documents with no organization that the
-- person owns, with the personal value as its limit. What counts is the stored
-- file of every document version, previous versions and documents in the trash
-- included (they count until their rows are purged); PDF copies and exports do
-- not. A version with no recorded size counts as zero. Bytes promised by
-- upload sessions that are still open count as used until the session ends or
-- expires: a pending session until its expires_at, a verifying one until its
-- five-minute lease lapses, an uploaded or processing one until it ends; only
-- the files of such a session that have not finished count.
create or replace function public.storage_space_usage(
  p_org_id uuid,
  p_user_id uuid,
  p_bytes_per_member bigint,
  p_personal_bytes bigint
)
returns table (used_bytes bigint, limit_bytes bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  stored_bytes bigint;
  promised_bytes bigint;
begin
  if p_org_id is not null then
    select coalesce(sum(coalesce(v.size_bytes, 0)), 0)::bigint into stored_bytes
    from public.documents d
    join public.document_versions v on v.document_id = d.id
    where d.org_id = p_org_id;

    select coalesce(sum(f.expected_size_bytes), 0)::bigint into promised_bytes
    from public.upload_sessions s
    join public.upload_session_files f on f.session_id = s.id
    where s.quota_org_id = p_org_id
      and s.status in ('pending_upload', 'verifying', 'uploaded', 'processing')
      and (s.status <> 'pending_upload' or s.expires_at > now())
      and (s.status <> 'verifying' or s.updated_at > now() - interval '5 minutes')
      and f.status in ('pending_upload', 'verifying', 'uploaded', 'processing');

    return query
      select stored_bytes + promised_bytes,
        p_bytes_per_member * (select count(*) from public.org_members m where m.org_id = p_org_id);
  else
    select coalesce(sum(coalesce(v.size_bytes, 0)), 0)::bigint into stored_bytes
    from public.documents d
    join public.document_versions v on v.document_id = d.id
    where d.org_id is null and d.user_id = p_user_id;

    select coalesce(sum(f.expected_size_bytes), 0)::bigint into promised_bytes
    from public.upload_sessions s
    join public.upload_session_files f on f.session_id = s.id
    where s.quota_org_id is null
      and s.quota_user_id = p_user_id
      and s.status in ('pending_upload', 'verifying', 'uploaded', 'processing')
      and (s.status <> 'pending_upload' or s.expires_at > now())
      and (s.status <> 'verifying' or s.updated_at > now() - interval '5 minutes')
      and f.status in ('pending_upload', 'verifying', 'uploaded', 'processing');

    return query select stored_bytes + promised_bytes, p_personal_bytes;
  end if;
end;
$$;

revoke all on function public.storage_space_usage(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.storage_space_usage(uuid, uuid, bigint, bigint)
  to service_role;

-- The old signature is replaced, not overloaded: PostgREST would otherwise see
-- two candidates for the same named call.
drop function if exists public.create_upload_session(uuid, uuid, text, jsonb, timestamptz, jsonb, integer);

create or replace function public.create_upload_session(
  target_session_id uuid,
  target_user_id uuid,
  target_purpose text,
  target_destination jsonb,
  target_expires_at timestamptz,
  target_files jsonb,
  target_hourly_session_limit integer default 50,
  target_quota_org_id uuid default null,
  target_quota_user_id uuid default null,
  target_quota_bytes_per_member bigint default null,
  target_quota_personal_bytes bigint default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manifest_file_count integer;
  manifest_total_bytes bigint;
  recent_session_count integer;
  space_used_bytes bigint;
  space_limit_bytes bigint;
begin
  if jsonb_typeof(target_files) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_upload_manifest';
  end if;
  -- The API issues a 30-minute expiry. Permit one minute of clock skew between
  -- the application host and Postgres while keeping the issued TTL unchanged.
  if target_expires_at <= now()
     or target_expires_at > now() + interval '31 minutes' then
    raise exception using errcode = '22023', message = 'invalid_upload_session_expiry';
  end if;
  if target_hourly_session_limit not between 1 and 1000000 then
    raise exception using errcode = '22023', message = 'invalid_upload_session_rate_limit';
  end if;

  select count(*), coalesce(sum(file_row.expected_size_bytes), 0)
    into manifest_file_count, manifest_total_bytes
  from jsonb_to_recordset(target_files) as file_row(
    id uuid,
    resource_id uuid,
    client_id text,
    filename text,
    target_folder_id uuid,
    file_type text,
    content_type text,
    expected_size_bytes bigint,
    staging_storage_path text,
    sealed_storage_path text
  );

  if manifest_file_count < 1 or manifest_file_count > 50 then
    raise exception using errcode = '22023', message = 'upload_file_count_limit_exceeded';
  end if;
  if manifest_total_bytes < 1 or manifest_total_bytes > 2147483648 then
    raise exception using errcode = '22023', message = 'upload_total_size_limit_exceeded';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_files) as file_row(
      id uuid,
      resource_id uuid,
      client_id text,
      filename text,
      target_folder_id uuid,
      file_type text,
      content_type text,
      expected_size_bytes bigint,
      staging_storage_path text,
      sealed_storage_path text
    )
    where file_row.id is null
       or file_row.resource_id is null
       or length(file_row.client_id) not between 1 and 128
       or length(file_row.filename) not between 1 and 255
       or file_row.file_type not in ('pdf', 'docx', 'doc', 'xlsx', 'xlsm', 'xls', 'pptx', 'ppt', 'md')
       or length(file_row.content_type) not between 1 and 255
       or file_row.expected_size_bytes not between 1 and 104857600
       or length(file_row.staging_storage_path) < 1
       or length(file_row.sealed_storage_path) < 1
  ) then
    raise exception using errcode = '22023', message = 'invalid_upload_manifest';
  end if;

  -- Namespace the advisory key: hashtextextended(user_id, 0) with no prefix is
  -- already taken by install_missing_default_workflows, and an un-namespaced
  -- key silently serializes unrelated features against each other (see the
  -- advisory-lock registry comment at the top of schema.sql).
  perform pg_advisory_xact_lock(
    hashtextextended('upload-session:' || target_user_id::text, 0)
  );

  -- Housekeeping runs FIRST, under the user lock: expire stale pending
  -- sessions and error out stale verifying ones before the busy check below.
  -- In the earlier draft these updates sat after the busy check, so the one
  -- branch where a stale session was exactly what blocked the caller
  -- (upload_target_busy) rolled them back and the 409 persisted until the
  -- 60-second background sweep happened to run.
  update public.upload_sessions
  set status = 'expired', updated_at = now()
  where user_id = target_user_id
    and status = 'pending_upload'
    and expires_at <= now();

  update public.upload_sessions
  set status = 'error', updated_at = now()
  where user_id = target_user_id
    and status = 'verifying'
    and updated_at <= now() - interval '5 minutes';

  if target_purpose in (
    'document_version_create',
    'document_version_replace',
    'workflow_reference_replace'
  ) and exists (
    select 1
    from public.upload_sessions
    where user_id = target_user_id
      and purpose = target_purpose
      and (
        (target_purpose = 'document_version_create'
          and destination ->> 'document_id' = target_destination ->> 'document_id')
        or (target_purpose = 'document_version_replace'
          and destination ->> 'document_id' = target_destination ->> 'document_id'
          and destination ->> 'version_id' = target_destination ->> 'version_id')
        or (target_purpose = 'workflow_reference_replace'
          and destination ->> 'workflow_id' = target_destination ->> 'workflow_id'
          and destination ->> 'reference_id' = target_destination ->> 'reference_id')
      )
      and status in ('pending_upload', 'verifying', 'uploaded', 'processing')
  ) then
    raise exception using errcode = 'P0001', message = 'upload_target_busy';
  end if;

  select count(*)
    into recent_session_count
  from public.upload_sessions
  where user_id = target_user_id
    and created_at > now() - interval '1 hour';

  if recent_session_count >= target_hourly_session_limit then
    raise exception using errcode = 'P0001', message = 'upload_session_rate_limit_exceeded';
  end if;

  -- Storage quota: a space (a firm, or one person's personal space) may not go
  -- over its limit by opening a session. The check and the insert below run
  -- under one lock per space, so two sessions opened at the same moment cannot
  -- both pass when together they exceed the limit. Bytes promised by sessions
  -- that are still open count as used (see storage_space_usage). The caller
  -- names the space; it passes neither id when no limit applies.
  if target_quota_org_id is not null or target_quota_user_id is not null then
    if (target_quota_org_id is not null and target_quota_bytes_per_member is null)
       or (target_quota_org_id is null and target_quota_personal_bytes is null) then
      raise exception using errcode = '22023', message = 'invalid_storage_quota_limits';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(
        'storage-space:' || coalesce(target_quota_org_id::text, 'user:' || target_quota_user_id::text),
        0
      )
    );
    select usage.used_bytes, usage.limit_bytes
      into space_used_bytes, space_limit_bytes
    from public.storage_space_usage(
      target_quota_org_id,
      target_quota_user_id,
      target_quota_bytes_per_member,
      target_quota_personal_bytes
    ) as usage;
    -- Exactly at the limit is accepted; one byte over is refused.
    if space_used_bytes + manifest_total_bytes > space_limit_bytes then
      raise exception using errcode = 'P0001', message = 'storage_quota_exceeded';
    end if;
  end if;

  insert into public.upload_sessions (
    id,
    user_id,
    purpose,
    destination,
    expected_file_count,
    expected_total_bytes,
    expires_at,
    quota_org_id,
    quota_user_id
  ) values (
    target_session_id,
    target_user_id,
    target_purpose,
    target_destination,
    manifest_file_count,
    manifest_total_bytes,
    target_expires_at,
    target_quota_org_id,
    target_quota_user_id
  );

  insert into public.upload_session_files (
    id,
    session_id,
    resource_id,
    client_id,
    filename,
    target_folder_id,
    file_type,
    content_type,
    expected_size_bytes,
    staging_storage_path,
    sealed_storage_path
  )
  select
    file_row.id,
    target_session_id,
    file_row.resource_id,
    file_row.client_id,
    file_row.filename,
    file_row.target_folder_id,
    file_row.file_type,
    file_row.content_type,
    file_row.expected_size_bytes,
    file_row.staging_storage_path,
    file_row.sealed_storage_path
  from jsonb_to_recordset(target_files) as file_row(
    id uuid,
    resource_id uuid,
    client_id text,
    filename text,
    target_folder_id uuid,
    file_type text,
    content_type text,
    expected_size_bytes bigint,
    staging_storage_path text,
    sealed_storage_path text
  );
end;
$$;

revoke all on function public.create_upload_session(uuid, uuid, text, jsonb, timestamptz, jsonb, integer, uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute
  on function public.create_upload_session(uuid, uuid, text, jsonb, timestamptz, jsonb, integer, uuid, uuid, bigint, bigint)
  to service_role;

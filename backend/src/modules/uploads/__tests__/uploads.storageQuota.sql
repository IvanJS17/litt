-- Storage quota (part 1): what a space uses, what its limit is, and the refusal
-- of a new upload session. Run only on a disposable database after schema.sql /
-- migrations. Every synthetic row is rolled back.
--   psql "$SUPABASE_TEST_DB_URL" -X --set ON_ERROR_STOP=1 -f uploads.storageQuota.sql
-- The limits are small numbers passed as arguments (the real ones are 10 GB per
-- member and 2 GB personal, set by the backend's configuration).
\set ON_ERROR_STOP on
begin;

create function pg_temp.one_file(size bigint) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'resource_id', gen_random_uuid(), 'client_id', 'c',
    'filename', 'quota.pdf', 'target_folder_id', null, 'file_type', 'pdf',
    'content_type', 'application/pdf', 'expected_size_bytes', size,
    'staging_storage_path', 'staging/' || gen_random_uuid(),
    'sealed_storage_path', 'sealed/' || gen_random_uuid()))
$$;

-- Opens a session the way the backend does; the reason of a refusal is returned.
create function pg_temp.open_session(
  sid uuid, uid uuid, size bigint, space_org uuid, space_user uuid
) returns text language plpgsql as $$
begin
  perform public.create_upload_session(
    sid, uid, 'document_create', '{"scope":"standalone"}'::jsonb,
    now() + interval '30 minutes', pg_temp.one_file(size), 50,
    space_org, space_user, 1000, 500);
  return 'opened';
exception when others then
  return sqlerrm;
end;
$$;

create function pg_temp.used(org uuid, usr uuid) returns bigint language sql as $$
  select used_bytes from public.storage_space_usage(org, usr, 1000, 500)
$$;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  firm uuid := gen_random_uuid();
  other_firm uuid := gen_random_uuid();
  project uuid := gen_random_uuid();
  other_project uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid();
  d_trash uuid := gen_random_uuid();
  d_other uuid := gen_random_uuid();
  d_personal1 uuid := gen_random_uuid();
  d_personal2 uuid := gen_random_uuid();
  s uuid;
  members integer;
  usage_row record;
begin
  insert into auth.users(id, email) values
    (u1, 'quota-1@example.invalid'), (u2, 'quota-2@example.invalid'), (u3, 'quota-3@example.invalid');
  insert into public.organizations(id, name) values (firm, 'Quota firm'), (other_firm, 'Other firm');
  insert into public.org_members(org_id, user_id, role) values
    (firm, u1, 'owner'), (firm, u2, 'member')
    on conflict do nothing;
  select count(*) into members from public.org_members where org_id = firm;
  insert into public.projects(id, user_id, org_id, name) values
    (project, u1, firm, 'Quota project'), (other_project, u3, other_firm, 'Other');

  -- The limit of a firm is the per-member value times the members who joined;
  -- a pending invitation adds nothing.
  select * into usage_row from public.storage_space_usage(firm, null, 1000, 500);
  assert usage_row.limit_bytes = 1000 * members, 'limit is per member times members';
  insert into public.org_invitations(org_id, email, role, status)
    values (firm, 'quota-3@example.invalid', 'member', 'pending');
  select * into usage_row from public.storage_space_usage(firm, null, 1000, 500);
  assert usage_row.limit_bytes = 1000 * members, 'a pending invitation adds no space';
  insert into public.org_members(org_id, user_id, role) values (firm, u3, 'member');
  select * into usage_row from public.storage_space_usage(firm, null, 1000, 500);
  assert usage_row.limit_bytes = 1000 * (members + 1), 'an accepted member adds space';
  delete from public.org_members where org_id = firm and user_id = u3;
  -- The personal limit is its own value.
  select * into usage_row from public.storage_space_usage(null, u1, 1000, 500);
  assert usage_row.limit_bytes = 500, 'personal limit';

  -- What counts: every version's stored file (previous versions, trashed
  -- documents, soft-deleted versions); a version without a size counts zero;
  -- PDF copies add nothing; documents of another firm do not mix in.
  insert into public.documents(id, project_id, org_id, user_id) values
    (d1, project, firm, u1), (d_trash, project, firm, u2), (d_other, other_project, other_firm, u3);
  insert into public.document_versions(document_id, version_number, storage_path, pdf_storage_path, size_bytes, filename) values
    (d1, 1, 'q/d1v1.docx', 'q/d1v1.pdf', 300, 'previous version'),
    (d1, 2, 'q/d1v2.docx', 'q/d1v2.pdf', 200, 'current version'),
    (d1, 3, 'q/d1v3.docx', null, null, 'no size recorded'),
    (d_trash, 1, 'q/dt.docx', null, 100, 'in the trash'),
    (d_other, 1, 'q/do.docx', null, 7777, 'another firm');
  update public.documents set archived_at = now() where id = d_trash;
  insert into public.document_versions(document_id, version_number, storage_path, size_bytes, filename, deleted_at)
    values (d1, 4, 'q/d1v4.docx', 50, 'deleted version still stored', now());
  assert pg_temp.used(firm, null) = 650, 'versions, previous ones, trash and soft-deleted count: ' || pg_temp.used(firm, null);
  assert pg_temp.used(other_firm, null) = 7777, 'another firm is counted apart';

  -- A person's personal space and a firm's space do not mix.
  insert into public.documents(id, org_id, user_id) values (d_personal1, null, u1), (d_personal2, null, u2);
  insert into public.document_versions(document_id, version_number, storage_path, size_bytes, filename) values
    (d_personal1, 1, 'q/p1.docx', 120, 'personal of one'),
    (d_personal2, 1, 'q/p2.docx', 80, 'personal of two');
  assert pg_temp.used(null, u1) = 120, 'personal usage is the person''s own: ' || pg_temp.used(null, u1);
  assert pg_temp.used(null, u2) = 80, 'another person''s personal usage';
  assert pg_temp.used(firm, null) = 650, 'personal documents do not count for the firm';

  -- Exactly at the limit is accepted; one byte over is refused.
  select count(*) into members from public.org_members where org_id = firm;
  assert pg_temp.open_session(gen_random_uuid(), u1, 1000 * members - 650 + 1, firm, null) = 'storage_quota_exceeded',
    'one byte over the limit is refused';
  assert not exists(select 1 from public.upload_sessions where user_id = u1), 'a refused session leaves nothing behind';
  s := gen_random_uuid();
  assert pg_temp.open_session(s, u1, 1000 * members - 650, firm, null) = 'opened', 'exactly at the limit is accepted';
  assert pg_temp.used(firm, null) = 1000 * members, 'an open session counts as used';
  assert pg_temp.open_session(gen_random_uuid(), u2, 1, firm, null) = 'storage_quota_exceeded', 'a full firm refuses another session';
  -- Another space is not affected.
  assert pg_temp.used(null, u1) = 120, 'a firm session does not count for the person';
  assert pg_temp.open_session(gen_random_uuid(), u1, 380, null, u1) = 'opened', 'personal space accepts up to its limit';
  assert pg_temp.open_session(gen_random_uuid(), u1, 1, null, u1) = 'storage_quota_exceeded', 'personal space refuses beyond it';
  assert pg_temp.used(firm, null) = 1000 * members, 'a personal session does not count for the firm';

  -- Editing, a generated document and a download are not upload sessions: at the
  -- limit a new version is still stored.
  perform public.create_document_version(d1, jsonb_build_object(
    'filename', 'edited.docx', 'source', 'user_edit', 'storage_path', 'q/edit.docx', 'size_bytes', 900));
  perform public.create_document_version(d1, jsonb_build_object(
    'filename', 'generated.docx', 'source', 'generated', 'storage_path', 'q/gen.docx', 'size_bytes', 500));
  assert pg_temp.used(firm, null) = 1000 * members + 1400, 'versions made by editing and generating are stored over the limit';

  -- Sessions stop counting when they end.
  update public.upload_sessions set status = 'cancelled' where id = s;
  assert pg_temp.used(firm, null) = 2050, 'a cancelled session no longer counts: ' || pg_temp.used(firm, null);
  update public.upload_sessions set status = 'pending_upload' where id = s;
  update public.upload_sessions set expires_at = now() - interval '1 minute' where id = s;
  assert pg_temp.used(firm, null) = 2050, 'an expired pending session no longer counts';
  update public.upload_sessions set expires_at = now() + interval '20 minutes', status = 'verifying',
    updated_at = now() - interval '6 minutes' where id = s;
  assert pg_temp.used(firm, null) = 2050, 'a verifying session whose lease lapsed no longer counts';
  update public.upload_sessions set status = 'processing', updated_at = now() where id = s;
  assert pg_temp.used(firm, null) = 2050 + (1000 * members - 650), 'a processing session counts';
  update public.upload_session_files set status = 'completed' where session_id = s;
  assert pg_temp.used(firm, null) = 2050, 'a finished file no longer counts as promised';
  update public.upload_sessions set status = 'completed' where id = s;
  assert pg_temp.used(firm, null) = 2050, 'a completed session no longer counts';
  update public.upload_sessions set status = 'expired' where id = s;
  assert pg_temp.used(firm, null) = 2050, 'an expired session no longer counts';

  -- Without a space named, the session opens as before (compatibility with a
  -- caller that does not pass one).
  perform public.create_upload_session(gen_random_uuid(), u2, 'document_create', '{"scope":"standalone"}'::jsonb,
    now() + interval '30 minutes', pg_temp.one_file(5), 50);
end;
$$;

rollback;
select 'storage quota: ok';

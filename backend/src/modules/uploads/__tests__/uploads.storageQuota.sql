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
-- The margin for a new version of an existing document is 10 %.
create function pg_temp.open_session(
  sid uuid, uid uuid, size bigint, space_org uuid, space_user uuid,
  purpose text default 'document_create',
  destination jsonb default '{"scope":"standalone"}'
) returns text language plpgsql as $$
begin
  perform public.create_upload_session(
    sid, uid, purpose, destination,
    now() + interval '30 minutes', pg_temp.one_file(size), 50,
    space_org, space_user, 1000, 500, 10);
  return 'opened';
exception when others then
  return sqlerrm;
end;
$$;

-- The shape the web editor opens when it saves an edit of a Word document.
create function pg_temp.save_edit(uid uuid, size bigint, space_org uuid, space_user uuid)
returns text language sql as $$
  select pg_temp.open_session(gen_random_uuid(), uid, size, space_org, space_user,
    'document_version_create',
    jsonb_build_object('document_id', gen_random_uuid(), 'base_version_id', gen_random_uuid(), 'generate_pdf', false))
$$;

-- The same with the real default limits (10 GiB per member, 2 GiB personal).
create function pg_temp.open_real(
  uid uuid, size bigint, space_org uuid, space_user uuid
) returns text language plpgsql as $$
begin
  perform public.create_upload_session(
    gen_random_uuid(), uid, 'document_create', '{"scope":"standalone"}'::jsonb,
    now() + interval '30 minutes', pg_temp.one_file(size), 50,
    space_org, space_user, 10737418240, 2147483648, 10);
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
  v4 uuid := gen_random_uuid();
  d_pers_org uuid := gen_random_uuid();
  pers_org uuid;
  firm2 uuid := gen_random_uuid();
  i integer;
  r text;
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
  insert into public.document_versions(id, document_id, version_number, storage_path, size_bytes, filename)
    values (v4, d1, 4, 'q/d1v4.docx', 50, 'a version that is about to be deleted');
  assert pg_temp.used(firm, null) = 650, 'every stored version counts, previous ones and archived documents included: ' || pg_temp.used(firm, null);
  -- Deleting a version clears its stored file and queues its removal; deleting a
  -- document removes its rows. Neither counts any more.
  perform public.delete_document_version(d1, v4, u1);
  assert pg_temp.used(firm, null) = 600, 'a deleted version no longer counts: ' || pg_temp.used(firm, null);
  delete from public.documents where id = d_trash;
  assert pg_temp.used(firm, null) = 500, 'a deleted document no longer counts: ' || pg_temp.used(firm, null);
  insert into public.documents(id, project_id, org_id, user_id) values (d_trash, project, firm, u2);
  insert into public.document_versions(document_id, version_number, storage_path, size_bytes, filename)
    values (d_trash, 1, 'q/dt.docx', 150, 'archived, files still stored');
  update public.documents set archived_at = now() where id = d_trash;
  assert pg_temp.used(firm, null) = 650, 'an archived document whose files are stored counts';
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
  -- Saving an edit (a new version of an existing document) keeps working at the
  -- limit, up to 10 % of the limit over it; a new document is refused at the limit.
  assert pg_temp.save_edit(u2, 1, firm, null) = 'opened', 'a version save at exactly the limit is accepted';
  assert pg_temp.open_session(gen_random_uuid(), u2, 1, firm, null) = 'storage_quota_exceeded', 'a new document is still refused at the limit';
  assert pg_temp.open_session(gen_random_uuid(), u2, 1, firm, null, 'workflow_reference_create', jsonb_build_object('workflow_id', gen_random_uuid())) = 'storage_quota_exceeded', 'the older workflow-file purpose creates documents and gets no margin';
  assert pg_temp.save_edit(u2, 1000 * members / 10 - 1, firm, null) = 'opened', 'a version save up to the margin is accepted';
  assert pg_temp.save_edit(u2, 1, firm, null) = 'storage_quota_exceeded', 'a version save beyond the margin is refused';
  assert pg_temp.used(firm, null) = 1000 * members + 1000 * members / 10, 'the margin is a tenth of the limit';
  update public.upload_sessions set status = 'cancelled' where user_id = u2 and quota_org_id = firm;
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

  -- A row carrying a person's personal organization is that person's personal
  -- space (no current path writes such rows; the shape is defended anyway).
  select id into pers_org from public.organizations where personal_user_id = u1;
  if pers_org is null then
    pers_org := gen_random_uuid();
    insert into public.organizations(id, name, kind, personal_user_id) values (pers_org, 'Personal', 'personal', u1);
  end if;
  insert into public.documents(id, org_id, user_id) values (d_pers_org, pers_org, u1);
  insert into public.document_versions(document_id, version_number, storage_path, size_bytes, filename)
    values (d_pers_org, 1, 'q/po.docx', 40, 'filed under the personal organization');
  assert pg_temp.used(null, u1) = 540, 'a personal organization''s row is charged to the personal space: ' || pg_temp.used(null, u1);

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

  -- One uploader cannot hold a space for everybody: what they hold promised in a
  -- firm's space is bounded by one session's cap (2 GiB), in somebody else's
  -- personal space by a quarter of its limit; in their own personal space only
  -- the space's limit applies. Real default limits from here.
  insert into public.organizations(id, name) values (firm2, 'Holding firm');
  insert into public.org_members(org_id, user_id, role) values (firm2, u1, 'owner'), (firm2, u2, 'member');
  for i in 1..20 loop
    assert pg_temp.open_real(u1, 104857600, firm2, null) = 'opened', 'a member holds up to 2 GiB in a firm: ' || i;
  end loop;
  assert pg_temp.open_real(u1, 104857600, firm2, null) = 'uploads_in_progress_limit', 'a member cannot hold more than one session''s cap';
  assert pg_temp.open_real(u1, 48 * 1048576, firm2, null) = 'opened', 'exactly at the cap is accepted';
  assert pg_temp.open_real(u1, 1, firm2, null) = 'uploads_in_progress_limit', 'one byte over the cap is refused';
  assert pg_temp.open_real(u2, 104857600, firm2, null) = 'opened', 'another member still can upload';
  assert pg_temp.open_real(u1, 100, null, u1) = 'opened', 'what is held in a firm does not count in the own personal space';
  update public.upload_sessions set status = 'cancelled' where user_id = u1 and quota_org_id = firm2;
  assert pg_temp.open_real(u1, 104857600, firm2, null) = 'opened', 'finished or cancelled sessions free the hold';
  -- somebody else's personal space: a quarter of 2 GiB = 512 MiB
  for i in 1..5 loop
    assert pg_temp.open_real(u3, 104857600, null, u2) = 'opened', 'an editor holds up to a quarter of another person''s space: ' || i;
  end loop;
  assert pg_temp.open_real(u3, 104857600, null, u2) = 'uploads_in_progress_limit', 'an editor cannot hold more than a quarter';
  -- the owner of the personal space: no extra bound
  for i in 1..15 loop
    assert pg_temp.open_real(u2, 104857600, null, u2) = 'opened', 'the owner is bounded only by the space (' || i || ')';
  end loop;

  -- A file whose version is already stored is not also counted as promised.
  s := gen_random_uuid();
  assert pg_temp.open_session(s, u3, 200, null, u3) = 'opened', 'personal session for the double count test';
  assert pg_temp.used(null, u3) = 200, 'the promised file counts';
  insert into public.documents(id, org_id, user_id)
    select resource_id, null, u3 from public.upload_session_files where session_id = s;
  insert into public.document_versions(id, document_id, version_number, storage_path, size_bytes, filename)
    select id, resource_id, 1, 'q/w1.pdf', 200, 'stored before the file is marked completed'
    from public.upload_session_files where session_id = s;
  assert pg_temp.used(null, u3) = 200, 'a file whose version is stored counts once: ' || pg_temp.used(null, u3);
  update public.upload_sessions set status = 'completed' where id = s;

  -- Without a space named, the session opens as before (compatibility with a
  -- caller that does not pass one).
  perform public.create_upload_session(gen_random_uuid(), u2, 'document_create', '{"scope":"standalone"}'::jsonb,
    now() + interval '30 minutes', pg_temp.one_file(5), 50);
end;
$$;

rollback;
select 'storage quota: ok';

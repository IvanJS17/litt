-- Migration date: 2026-11-06
--
-- LiTT training, layer 1b (docs/training.md): the pasante seal on document
-- versions and the approvals that release a sealed version.
--
-- A version whose content a pasante wrote carries training_stage = 'pasante'
-- and training_author_user_id = that person. The backend decides the seal
-- (the effective stage comes from lib/training.ts) and writes it through the
-- two insertion points, create_document_version and append_ai_review_export,
-- or through an in-place update. Once set, the seal is never removed or
-- reassigned: document_versions_training_seal_keep restores it on update.
-- training_author_user_id has no foreign key on purpose: the seal outlives
-- the author's account, like an audit record.
--
-- training_version_approvals is insert-only evidence that a lawyer or the
-- author's mentor approved the bytes with a given content_sha256. An
-- approval for an older hash does not release the current bytes. It has no
-- foreign keys either, so deleting a document, an organization or an account
-- (which would otherwise cascade into a delete the guard refuses) leaves the
-- evidence in place. RLS is on with no policies or browser grants.
--
-- No backfill: versions written before this migration have no seal.
--
-- Safe to re-run: if not exists, create or replace, drop-before-create.

alter table public.document_versions
  add column if not exists training_author_user_id uuid,
  add column if not exists training_stage text;

alter table public.document_versions
  drop constraint if exists document_versions_training_stage_check;
alter table public.document_versions
  add constraint document_versions_training_stage_check
  check (training_stage = 'pasante');
alter table public.document_versions
  drop constraint if exists document_versions_training_seal_check;
alter table public.document_versions
  add constraint document_versions_training_seal_check
  check ((training_stage is null) = (training_author_user_id is null));

-- A seal is never removed or handed to somebody else.
create or replace function public.document_versions_training_seal_keep()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.training_stage is not null then
    new.training_stage := old.training_stage;
    new.training_author_user_id := old.training_author_user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.document_versions_training_seal_keep() from public, anon, authenticated;

drop trigger if exists document_versions_training_seal_keep on public.document_versions;
create trigger document_versions_training_seal_keep
  before update on public.document_versions
  for each row execute function public.document_versions_training_seal_keep();

create table if not exists public.training_version_approvals (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null,
  content_sha256 text not null,
  org_id uuid,
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  constraint training_version_approvals_sha256_check
    check (content_sha256 ~ '^[0-9a-f]{64}$')
);
create unique index if not exists training_version_approvals_version_hash_key
  on public.training_version_approvals(document_version_id, content_sha256);

alter table public.training_version_approvals enable row level security;
revoke all on public.training_version_approvals from public, anon, authenticated, service_role;
grant select, insert on public.training_version_approvals to service_role;

drop trigger if exists training_version_approvals_insert_only on public.training_version_approvals;
create trigger training_version_approvals_insert_only
  before update or delete on public.training_version_approvals
  for each row execute function public.ai_append_only_guard();

-- create_document_version writes the seal the backend decided.
create or replace function public.create_document_version(
  p_document_id uuid, p_version jsonb, p_activate boolean default true
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := coalesce((p_version->>'id')::uuid, gen_random_uuid());
  v_row public.document_versions%rowtype;
  v_number integer;
begin
  perform 1 from public.documents where id = p_document_id for update;
  if not found then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  select * into v_row from public.document_versions where id = v_id;
  if found then
    if v_row.document_id <> p_document_id or v_row.deleted_at is not null then
      raise exception 'version_identity_conflict' using errcode = '23505';
    end if;
    -- An upload retry must not overwrite metadata or reactivate an older
    -- version after somebody has already created a newer one.
    return to_jsonb(v_row);
  end if;
  v_number := (p_version->>'version_number')::integer;
  if v_number is null then
    select coalesce(max(version_number), 1) + 1 into v_number
    from public.document_versions
    where document_id = p_document_id
      and source in ('upload', 'user_upload', 'assistant_edit');
  end if;
  insert into public.document_versions(
    id, document_id, storage_path, pdf_storage_path, source, version_number,
    filename, file_type, size_bytes, page_count, textless_page_count,
    content_sha256, training_author_user_id, training_stage
  ) values (
    v_id, p_document_id, p_version->>'storage_path', p_version->>'pdf_storage_path',
    coalesce(p_version->>'source', 'upload'), v_number,
    p_version->>'filename', p_version->>'file_type',
    (p_version->>'size_bytes')::integer, (p_version->>'page_count')::integer,
    (p_version->>'textless_page_count')::integer,
    p_version->>'content_sha256',
    (p_version->>'training_author_user_id')::uuid, p_version->>'training_stage'
  ) returning * into v_row;
  if p_activate then
    update public.documents set current_version_id = v_id, updated_at = now()
      where id = p_document_id;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.create_document_version(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.create_document_version(uuid, jsonb, boolean) to service_role;

-- append_ai_review_export (A10) seals the report when the reviewer is a
-- pasante: the backend adds training_stage = 'pasante' to p_artifact, and the
-- reviewer (p_actor_user_id) is the author.
create or replace function public.append_ai_review_export(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_authorization_epoch bigint,
  p_artifact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.ai_reviews%rowtype;
  v_existing public.ai_review_exports%rowtype;
  v_artifact_document_id uuid;
  v_artifact_version_id uuid;
begin
  if not public.ai_jsonb_exact_keys(
    p_artifact - 'training_stage',
    array['idempotency_key','review_id','review_revision','execution_id','organization_id','matter_id','project_id','document_id','document_version_id','source_document_sha256','evidence_receipt_sha256','filename','mime_type','artifact_sha256','artifact_document_id','artifact_document_version_id','storage_path','size_bytes']
  )
     or not public.ai_valid_idempotency_key(p_artifact->>'idempotency_key')
     -- LiTT training: the reviewer's effective stage, resolved by the backend;
     -- only 'pasante' seals the report (docs/training.md).
     or coalesce(p_artifact->>'training_stage', 'pasante') <> 'pasante'
     or not public.ai_valid_sha256(p_artifact->>'source_document_sha256')
     or not public.ai_valid_sha256(p_artifact->>'evidence_receipt_sha256')
     or not public.ai_valid_sha256(p_artifact->>'artifact_sha256')
     or p_artifact->>'filename' is distinct from 'Informe de revision humana.docx'
     or p_artifact->>'mime_type' is distinct from 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     or p_artifact->>'size_bytes' !~ '^[1-9][0-9]*$'
     or (p_artifact->>'size_bytes')::bigint > 2147483647
     or p_artifact->>'storage_path' is distinct from format(
       'orgs/%s/matters/%s/projects/%s/documents/%s/%s.docx',
       (p_artifact->>'organization_id')::uuid,
       (p_artifact->>'matter_id')::uuid,
       (p_artifact->>'project_id')::uuid,
       (p_artifact->>'artifact_document_id')::uuid,
       p_artifact->>'artifact_sha256'
     )
  then
    raise exception 'Invalid AI review export contract';
  end if;

  v_artifact_document_id := (p_artifact->>'artifact_document_id')::uuid;
  v_artifact_version_id := (p_artifact->>'artifact_document_version_id')::uuid;

  select * into v_review
    from public.ai_reviews where id = (p_artifact->>'review_id')::uuid
    for update;
  if v_review.id is null
     or v_review.status is distinct from 'approved'
     or v_review.reviewer_user_id is distinct from p_actor_user_id
     or v_review.organization_id is distinct from p_organization_id
     or v_review.revision is distinct from (p_artifact->>'review_revision')::integer
     or v_review.execution_id is distinct from (p_artifact->>'execution_id')::uuid
     or v_review.matter_id is distinct from (p_artifact->>'matter_id')::uuid
     or v_review.project_id is distinct from (p_artifact->>'project_id')::uuid
     or v_review.document_id is distinct from (p_artifact->>'document_id')::uuid
     or v_review.document_version_id is distinct from (p_artifact->>'document_version_id')::uuid
     or v_review.document_content_sha256 is distinct from p_artifact->>'source_document_sha256'
     or v_review.evidence_receipt_sha256 is distinct from p_artifact->>'evidence_receipt_sha256'
  then
    raise exception 'AI review export scope is invalid';
  end if;
  perform public.ai_assert_active_matter_access(
    p_actor_user_id, p_organization_id, v_review.matter_id,
    v_review.project_id, p_authorization_epoch, 'review'
  );

  select * into v_existing
    from public.ai_review_exports
   where idempotency_key = p_artifact->>'idempotency_key';
  if found then
    if v_existing.review_id is distinct from v_review.id
       or v_existing.review_id is distinct from (p_artifact->>'review_id')::uuid
       or v_existing.review_revision is distinct from v_review.revision
       or v_existing.review_revision is distinct from (p_artifact->>'review_revision')::integer
       or v_existing.execution_id is distinct from v_review.execution_id
       or v_existing.execution_id is distinct from (p_artifact->>'execution_id')::uuid
       or v_existing.organization_id is distinct from v_review.organization_id
       or v_existing.organization_id is distinct from p_organization_id
       or v_existing.organization_id is distinct from (p_artifact->>'organization_id')::uuid
       or v_existing.matter_id is distinct from v_review.matter_id
       or v_existing.matter_id is distinct from (p_artifact->>'matter_id')::uuid
       or v_existing.project_id is distinct from v_review.project_id
       or v_existing.project_id is distinct from (p_artifact->>'project_id')::uuid
       or v_existing.source_document_id is distinct from v_review.document_id
       or v_existing.source_document_id is distinct from (p_artifact->>'document_id')::uuid
       or v_existing.source_document_version_id is distinct from v_review.document_version_id
       or v_existing.source_document_version_id is distinct from (p_artifact->>'document_version_id')::uuid
       or v_existing.source_document_sha256 is distinct from v_review.document_content_sha256
       or v_existing.source_document_sha256 is distinct from p_artifact->>'source_document_sha256'
       or v_existing.evidence_receipt_sha256 is distinct from v_review.evidence_receipt_sha256
       or v_existing.evidence_receipt_sha256 is distinct from p_artifact->>'evidence_receipt_sha256'
       or v_existing.artifact_document_id is distinct from v_artifact_document_id
       or v_existing.artifact_document_id is distinct from (p_artifact->>'artifact_document_id')::uuid
       or v_existing.artifact_document_version_id is distinct from v_artifact_version_id
       or v_existing.artifact_document_version_id is distinct from (p_artifact->>'artifact_document_version_id')::uuid
       or v_existing.filename is distinct from p_artifact->>'filename'
       or v_existing.mime_type is distinct from p_artifact->>'mime_type'
       or v_existing.artifact_sha256 is distinct from p_artifact->>'artifact_sha256'
       or v_existing.storage_path is distinct from p_artifact->>'storage_path'
       or v_existing.size_bytes is distinct from (p_artifact->>'size_bytes')::integer
       or not exists (
         select 1 from public.document_versions v
         join public.documents d on d.id = v.document_id
         where v.id = v_artifact_version_id
           and v.document_id = v_artifact_document_id
           and d.project_id = v_review.project_id
           and v.storage_path = p_artifact->>'storage_path'
           and v.filename = p_artifact->>'filename'
           and v.file_type = p_artifact->>'mime_type'
           and v.size_bytes = (p_artifact->>'size_bytes')::integer
           and v.content_sha256 = p_artifact->>'artifact_sha256'
           and v.source = 'ai_review_report'
       )
    then
      raise exception 'AI review export idempotency conflict';
    end if;
    return jsonb_build_object(
      'disposition','replayed','review_id',v_review.id,
      'review_revision',v_review.revision,'execution_id',v_review.execution_id,
      'artifact_sha256',v_existing.artifact_sha256,
      'idempotency_key',v_existing.idempotency_key
    );
  end if;

  insert into public.documents(id, project_id, user_id, status)
    values (v_artifact_document_id, v_review.project_id, p_actor_user_id, 'completed')
    on conflict (id) do nothing;
  if not exists (
    select 1 from public.documents
     where id = v_artifact_document_id and project_id = v_review.project_id
  ) then
    raise exception 'AI review export artifact document conflict';
  end if;
  insert into public.document_versions(
    id, document_id, storage_path, filename, file_type, size_bytes,
    content_sha256, source, created_at,
    training_author_user_id, training_stage
  ) values (
    v_artifact_version_id, v_artifact_document_id,
    p_artifact->>'storage_path', p_artifact->>'filename',
    p_artifact->>'mime_type', (p_artifact->>'size_bytes')::integer,
    p_artifact->>'artifact_sha256', 'ai_review_report', now(),
    case when p_artifact->>'training_stage' = 'pasante' then p_actor_user_id end,
    p_artifact->>'training_stage'
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.document_versions
       where id = v_artifact_version_id
       and document_id = v_artifact_document_id
       and storage_path = p_artifact->>'storage_path'
       and filename = p_artifact->>'filename'
       and file_type = p_artifact->>'mime_type'
       and size_bytes = (p_artifact->>'size_bytes')::integer
       and content_sha256 = p_artifact->>'artifact_sha256'
       and source = 'ai_review_report'
  ) then
    raise exception 'AI review export artifact version conflict';
  end if;

  insert into public.ai_review_exports (
    idempotency_key, review_id, review_revision, execution_id,
    organization_id, matter_id, project_id,
    source_document_id, source_document_version_id,
    artifact_document_id, artifact_document_version_id,
    source_document_sha256, evidence_receipt_sha256,
    filename, mime_type, artifact_sha256, storage_path, size_bytes
  ) values (
    p_artifact->>'idempotency_key', v_review.id, v_review.revision,
    v_review.execution_id, v_review.organization_id, v_review.matter_id,
    v_review.project_id, v_review.document_id, v_review.document_version_id,
    v_artifact_document_id, v_artifact_version_id,
    v_review.document_content_sha256, v_review.evidence_receipt_sha256,
    p_artifact->>'filename', p_artifact->>'mime_type',
    p_artifact->>'artifact_sha256', p_artifact->>'storage_path',
    (p_artifact->>'size_bytes')::integer
  );

  return jsonb_build_object(
    'disposition','applied','review_id',v_review.id,
    'review_revision',v_review.revision,'execution_id',v_review.execution_id,
    'artifact_sha256',p_artifact->>'artifact_sha256',
    'idempotency_key',p_artifact->>'idempotency_key'
  );
end
$$;


-- Migration date: 2026-11-06
--
-- LiTT training, layer 1b (docs/training.md): a version sealed for a
-- pasante always belongs to a document with an organization.
--
-- No backfill and no scan: 20261106_51 has not reached any deployment with
-- data, and every sealed version the backend writes already has one.
--
-- Safe to re-run: create or replace, drop-before-create.

-- A sealed version lives only in a document with an organization: approval
-- is decided inside one (documents.trainingApproval), so a sealed version
-- outside one could never be released. The backend already refuses such a
-- write (documents.lifecycle); these triggers hold the rule for every
-- writer. A CHECK cannot read documents.org_id from document_versions, so
-- both sides are guarded: writing a seal into a document without an
-- organization, and taking the organization away from a document that holds
-- a sealed version. Each runs after the trigger that settles the value it
-- reads (seal_keep, then sync_project_org, by name order).
create or replace function public.document_versions_training_seal_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.training_stage is not null and not exists (
    select 1 from public.documents d
    where d.id = new.document_id and d.org_id is not null
  ) then
    raise exception 'A pasante''s version needs a document in an organization'
      using errcode = '23514', constraint = 'document_versions_training_seal_org';
  end if;
  return new;
end;
$$;
revoke all on function public.document_versions_training_seal_org() from public, anon, authenticated;

drop trigger if exists document_versions_training_seal_org on public.document_versions;
create trigger document_versions_training_seal_org
  before insert or update of training_stage, document_id on public.document_versions
  for each row execute function public.document_versions_training_seal_org();

create or replace function public.documents_training_seal_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is null and exists (
    select 1 from public.document_versions v
    where v.document_id = new.id and v.training_stage is not null
  ) then
    raise exception 'A document with a pasante''s version must stay in an organization'
      using errcode = '23514', constraint = 'documents_training_seal_org';
  end if;
  return new;
end;
$$;
revoke all on function public.documents_training_seal_org() from public, anon, authenticated;

drop trigger if exists documents_training_seal_org on public.documents;
create trigger documents_training_seal_org
  before update of org_id, project_id on public.documents
  for each row execute function public.documents_training_seal_org();

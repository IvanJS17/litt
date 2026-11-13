-- Migration date: 2026-11-12
--
-- Split a case file (layer 7, docs/document-split.md).
--
-- 1. document_versions.source accepts 'split': the first (and only) version of
--    a PDF that a person made by splitting one PDF with several documents in
--    it into one PDF per document. Like 'converted' and 'compared', version
--    numbering is unchanged: the split names version 1 itself.
-- 2. The list of document types Split sorts pages into can be adjusted. It is
--    a small list of {name, description, identifier?} kept as one jsonb value:
--    per person in user_profiles.split_classes and per firm in
--    organizations.split_classes. NULL means "use the next one": the person's,
--    then the firm's, then the list shipped in the code. The server validates
--    it (shape, length, at most 19 types, which is LandingAI Split's limit)
--    and every client role is already revoked from both tables.
--
-- Re-runnable: the constraints are dropped and re-added, the columns use
-- if not exists.

alter table public.document_versions
  drop constraint if exists document_versions_source_check;
alter table public.document_versions
  add constraint document_versions_source_check
  check (source = any (array[
    'upload'::text,
    'user_upload'::text,
    'assistant_edit'::text,
    'user_accept'::text,
    'user_reject'::text,
    'generated'::text,
    'ai_review_report'::text,
    'user_edit'::text,
    'converted'::text,
    'compared'::text,
    'split'::text
  ]));

alter table public.user_profiles
  add column if not exists split_classes jsonb;
alter table public.user_profiles
  drop constraint if exists user_profiles_split_classes_check;
alter table public.user_profiles
  add constraint user_profiles_split_classes_check
  check (split_classes is null or (
    jsonb_typeof(split_classes) = 'array'
    and jsonb_array_length(split_classes) between 1 and 19
    and octet_length(split_classes::text) <= 20000
  ));

alter table public.organizations
  add column if not exists split_classes jsonb;
alter table public.organizations
  drop constraint if exists organizations_split_classes_check;
alter table public.organizations
  add constraint organizations_split_classes_check
  check (split_classes is null or (
    jsonb_typeof(split_classes) = 'array'
    and jsonb_array_length(split_classes) between 1 and 19
    and octet_length(split_classes::text) <= 20000
  ));

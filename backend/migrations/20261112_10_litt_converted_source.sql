-- Migration date: 2026-11-12
--
-- Converted documents. document_versions.source accepts 'converted': the first
-- (and only) version of a document that a person made by converting another
-- one between Markdown, Word and PDF. It is not 'generated' (the assistant's)
-- and not 'upload' (nothing was uploaded). Version numbering is unchanged:
-- the conversion names version 1 itself, and no other version is ever added
-- to such a document by this feature.
-- Re-runnable: the constraint is dropped and re-added.

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
    'converted'::text
  ]));

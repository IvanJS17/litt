-- Migration date: 2026-11-12
--
-- Compared documents. document_versions.source accepts 'compared': the first
-- (and only) version of a Word document that a person made by comparing two
-- Word documents of one project into a third with tracked changes. It is not
-- 'converted' (no format changed) and not 'upload' (nothing was uploaded).
-- Version numbering is unchanged: the comparison names version 1 itself.
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
    'converted'::text,
    'compared'::text
  ]));

-- Migration date: 2026-11-19
--
-- document_versions.source accepts 'mcp_client': the first version of a note
-- that another app (Claude, through the MCP server) wrote into a matter with
-- create_note_document. It was stored as 'generated' because the constraint
-- did not admit this value.
--
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
    'compared'::text,
    'split'::text,
    'mcp_client'::text
  ]));

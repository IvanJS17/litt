-- Migration date: 2026-11-22
--
-- A playbook run keeps the findings and the summary it wrote about the
-- document it reviewed. When that document is deleted, playbook_runs.document_id
-- goes to null, so a run over a document that is gone cannot be told from a run
-- over text that was pasted in. Whether a reader may still read the findings
-- depends on which one it was.
--
-- stored_document records it: true for a run over a stored document, false for
-- one over pasted text, null when it is not known.
--
-- Existing rows:
--   * with a document_id: true (the document is stored).
--   * with neither a document_id nor a document_name: false (pasted text that
--     was never given a name).
--   * with a document_name and no document_id: left null. It may be a deleted
--     document or named pasted text; readers withhold its findings, as they
--     withhold any run whose source cannot be established.
-- New runs set it when they are created. A run written by an older server keeps
-- null and is read by the same rule.
--
-- Safe to re-run: the column is added if not exists and only null values are
-- filled in.

alter table public.playbook_runs
  add column if not exists stored_document boolean;

update public.playbook_runs
   set stored_document = true
 where stored_document is null and document_id is not null;

update public.playbook_runs
   set stored_document = false
 where stored_document is null and document_id is null and document_name is null;

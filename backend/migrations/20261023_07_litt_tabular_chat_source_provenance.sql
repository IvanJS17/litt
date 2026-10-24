-- Migration date: 2026-10-23
--
-- Tabular review chat transcripts carry source provenance (LiTT sync
-- 2026-10-23, S1). Port of LiTT 20261022_03_recovery_tabular_chat_source_provenance.
--
-- A review chat answers over cells and row labels extracted from the review's
-- source documents, which may belong to another project. Review access is not
-- document access, so a transcript cannot be shared on review access alone: a
-- member who cannot read those documents, or whose access was revoked, must
-- not read their text through a colleague's transcript, an export or a queued
-- export/memory job.
--
-- source_document_ids records, per message, every document whose derived text
-- could have reached it (cumulative per chat, since earlier turns are replayed
-- to the model). The backend shows a message only to readers who can read all
-- of them. Existing messages stay NULL = unknown provenance: they are withheld
-- from every reader and taint later turns of the same chat. Nothing is deleted.
--
-- Re-runnable: add column if not exists.

alter table public.tabular_review_chat_messages
  add column if not exists source_document_ids uuid[];

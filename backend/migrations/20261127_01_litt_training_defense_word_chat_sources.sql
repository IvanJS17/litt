-- Migration date: 2026-11-27
--
-- A defense over a practice area is written from the notes of the pupil's
-- works, Word works included. source_word_chat_ids records the Word chats those
-- notes came from when the questions were written, as source_project_ids
-- records the matters; an empty list is none used; null is not recorded.
-- Its questions and note are read only while every work they rest on is one the
-- reader may see now.
--
-- Existing rows: left null, nothing is rewritten or deleted. A defense over a
-- practice area with questions or a note and no recorded Word chats is of
-- unknown basis and is withheld from every reader (its outcome stays). New
-- questions record their Word chats.
--
-- Safe to re-run: the column is added if not exists.

alter table public.training_defenses
  add column if not exists source_word_chat_ids uuid[];

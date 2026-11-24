-- Migration date: 2026-11-22
--
-- An oral defense's questions are written from the pupil's work: the linked
-- work, or else the works of a practice area the generating mentor could open.
-- The pupil's current mentor reads those questions only while they can open the
-- matters of that work. source_project_ids records the matters a defense's
-- questions were drawn from when they were written; an empty list is work done
-- outside any matter; null is not recorded.
--
-- Existing rows: left null. A defense on one linked work is judged by that
-- work's matter as it is now, so null does not matter to it. A defense over a
-- practice area with questions or a note and no recorded matters is withheld
-- from every mentor (the questions and the note; the outcome stays), because
-- what it rests on cannot be established. New questions record their matters.
--
-- Safe to re-run: the column is added if not exists.

alter table public.training_defenses
  add column if not exists source_project_ids uuid[];

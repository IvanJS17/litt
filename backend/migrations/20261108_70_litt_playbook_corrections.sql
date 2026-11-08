-- Migration date: 2026-11-08
--
-- LiTT training, layer 3 (docs/training.md, "From correction to rule"): a
-- mentor's corrections of a pupil's work, proposed as rules for a playbook.
--
-- public.playbook_imports.kind     also 'correction': a batch of corrections
--                                  compiled by the same playbook.draft job as
--                                  a proposal. request_json holds the
--                                  corrections and the pupil's id until the
--                                  job ends, then it is null; nothing about
--                                  the pupil stays on the row.
-- public.playbook_changes.source   also 'correction'.
-- public.playbook_changes.attributed_to
--                                  the person whose correction it is (the
--                                  mentor who sent it), for the rule's
--                                  "Correction by …" note. Never the pupil.
--                                  Set to null when that account is erased.
--
-- One batch of corrections runs per playbook (a unique partial index, like
-- the one for proposals), so two requests that both passed the backend's
-- checks cannot both start one.
--
-- No learning data is stored here: the rules, which belong to the firm, are
-- written without the pupil's text and without naming the pupil. No rows are
-- inserted.
--
-- Safe to re-run: add column if not exists, drop-before-create for
-- constraints, create ... if not exists.

alter table public.playbook_imports drop constraint if exists playbook_imports_kind_check;
alter table public.playbook_imports add constraint playbook_imports_kind_check
  check (kind in ('import', 'draft', 'proposal', 'correction'));

alter table public.playbook_changes drop constraint if exists playbook_changes_source_check;
alter table public.playbook_changes add constraint playbook_changes_source_check
  check (source in ('starting_point', 'correction'));

alter table public.playbook_changes add column if not exists attributed_to uuid
  references auth.users(id) on delete set null;
alter table public.playbook_changes drop constraint if exists playbook_changes_attribution_check;
alter table public.playbook_changes add constraint playbook_changes_attribution_check
  check (attributed_to is null or source = 'correction');
create index if not exists idx_playbook_changes_attributed_to
  on public.playbook_changes(attributed_to) where attributed_to is not null;

create unique index if not exists idx_playbook_imports_one_running_correction
  on public.playbook_imports(playbook_id)
  where status = 'running' and kind = 'correction';

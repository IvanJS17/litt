-- Migration date: 2026-11-08
--
-- LiTT training layer 3, "Criterio" (docs/training.md): the contrast of a
-- pasante's turn gains a structured verdict, the pasante marks how sure they
-- are, and the note remembers whether the answer carried unverified citations.
-- Everything lives in the existing training_turn_notes table: it is learning
-- data, hangs from org_members with on delete cascade, has RLS on and no
-- policy or browser grant, so the columns below are covered by the same
-- visibility rule (training_can_read_learning) and go with the membership.
--
-- * confidence 1..4: the pasante's own mark on their approach, written with
--   the note. Null on the notes of layers 1 and 2.
-- * verdict (coincide | parcial | no_coincide): how the approach matches the
--   answer, according to the AI contrast; verdict_source says who decided it
--   ('contrast' the model, 'mentor' a correction by the current mentor, who
--   is recorded in verdict_by while the account exists).
-- * foundation (solid | weak | wrong) and foundation_question: the basis of
--   the approach judged apart from its conclusion, and the one question the
--   contrast asks when the verdict matches but the basis does not.
-- * topics: up to three short labels the contrast proposes.
-- * answer_unverified: the answer had a citation the server could not verify;
--   such a turn does not count as evidence.
-- * mode and step: hints and counterpart rounds (a later card writes them).
-- * contrast_status also admits 'skipped': a turn with nothing to contrast.
--
-- Nothing is removed or reinterpreted: the notes of layers 1 and 2 keep the
-- new columns null. Safe to re-run: add column if not exists, create or
-- replace, drop-before-add constraints.

create or replace function public.training_topics_valid(p_topics text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_topics is null
    or (
      cardinality(p_topics) between 1 and 3
      and array_ndims(p_topics) = 1
      and not exists (
        select 1 from unnest(p_topics) t
        where t is null or char_length(btrim(t)) not between 1 and 80
      )
    );
$$;

revoke all on function public.training_topics_valid(text[]) from public, anon, authenticated;
grant execute on function public.training_topics_valid(text[]) to service_role;

alter table public.training_turn_notes
  add column if not exists confidence smallint,
  add column if not exists verdict text,
  add column if not exists verdict_source text,
  add column if not exists verdict_by uuid references auth.users(id) on delete set null,
  add column if not exists foundation text,
  add column if not exists foundation_question text,
  add column if not exists topics text[],
  add column if not exists answer_unverified boolean not null default false,
  add column if not exists mode text,
  add column if not exists step smallint;

alter table public.training_turn_notes
  drop constraint if exists training_turn_notes_status_check;
alter table public.training_turn_notes
  add constraint training_turn_notes_status_check check (
    contrast_status in ('pending', 'ready', 'failed', 'skipped')
  );

alter table public.training_turn_notes
  drop constraint if exists training_turn_notes_confidence_check;
alter table public.training_turn_notes
  add constraint training_turn_notes_confidence_check check (
    confidence is null or confidence between 1 and 4
  );

alter table public.training_turn_notes
  drop constraint if exists training_turn_notes_verdict_check;
alter table public.training_turn_notes
  add constraint training_turn_notes_verdict_check check (
    (verdict is null or verdict in ('coincide', 'parcial', 'no_coincide'))
    and (verdict is null) = (verdict_source is null)
    and (verdict_source is null or verdict_source in ('contrast', 'mentor'))
    and (verdict_by is null or verdict_source = 'mentor')
  );

alter table public.training_turn_notes
  drop constraint if exists training_turn_notes_foundation_check;
alter table public.training_turn_notes
  add constraint training_turn_notes_foundation_check check (
    (foundation is null or foundation in ('solid', 'weak', 'wrong'))
    and (
      foundation_question is null
      or (
        coalesce(foundation in ('weak', 'wrong'), false)
        and char_length(foundation_question) between 1 and 500
      )
    )
  );

alter table public.training_turn_notes
  drop constraint if exists training_turn_notes_topics_check;
alter table public.training_turn_notes
  add constraint training_turn_notes_topics_check check (
    public.training_topics_valid(topics)
  );

alter table public.training_turn_notes
  drop constraint if exists training_turn_notes_mode_check;
alter table public.training_turn_notes
  add constraint training_turn_notes_mode_check check (
    (mode is null or mode in ('hint', 'counterpart', 'counterpart_close'))
    and (mode is null) = (step is null)
    and (step is null or step between 1 and 3)
  );

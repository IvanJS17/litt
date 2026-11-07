-- Migration date: 2026-11-07
--
-- LiTT training layer 2 (docs/training.md): the outcome of an oral defense
-- and the end of an urgency pass when the pupil's mentor changes.
--
-- 1. A defense's outcome carries a reason from a closed list
--    (outcome_reason) and a note of up to 500 characters. Both are learning
--    data: they stay on the row and never reach the audit. The reason is
--    set with the outcome, and like the rest of the outcome it is recorded
--    once (training_defenses_outcome_once).
-- 2. Only the pupil's CURRENT mentor may grant a pass, so a pass in force
--    ends when another mentor takes the pupil: a trigger on training_pupils
--    revokes it in the same statement that changes the mentor, whatever
--    path changes it. revoked_by is whoever made the change.
--
-- No outcome could be recorded before this change (no endpoint wrote one),
-- so the stricter checks hold for every existing row.
--
-- Safe to re-run: if not exists, create or replace, drop-before-create.

alter table public.training_defenses add column if not exists outcome_reason text;

alter table public.training_defenses drop constraint if exists training_defenses_outcome_check;
alter table public.training_defenses add constraint training_defenses_outcome_check check (
  (outcome is null or outcome in ('approved', 'not_approved'))
  and (outcome is null) = (held_at is null)
  and (outcome is null) = (outcome_reason is null)
  and (outcome_reason is null or outcome_reason in (
    'razonamiento_solido', 'razonamiento_incompleto', 'cambio_de_hechos_no_resuelto',
    'sin_sustento', 'otro'
  ))
  and (outcome_note is null or (outcome is not null and char_length(outcome_note) <= 500))
  -- recorded_by is set with the outcome and goes to null with that account.
  and (recorded_by is null or outcome is not null)
);

-- A defense's outcome is recorded once; correcting it is a new defense.
-- Only the recorder's id may still change, to null, when that account goes.
create or replace function public.training_defenses_outcome_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.outcome is not null and (
    new.outcome is distinct from old.outcome
    or new.outcome_reason is distinct from old.outcome_reason
    or new.outcome_note is distinct from old.outcome_note
    or new.held_at is distinct from old.held_at
    or (new.recorded_by is not null and new.recorded_by is distinct from old.recorded_by)
  ) then
    raise exception 'A training defense outcome is recorded once'
      using errcode = 'LT002';
  end if;
  return new;
end;
$$;
revoke all on function public.training_defenses_outcome_once() from public, anon, authenticated;

-- A pass is the mentor's: when the pupil gets another mentor, every pass
-- still in force for them ends now.
create or replace function public.training_pupils_mentor_change_ends_passes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mentor_user_id is distinct from old.mentor_user_id then
    update public.training_urgency_passes
       set revoked_at = now(), revoked_by = new.assigned_by
     where org_id = new.org_id
       and trainee_user_id = new.trainee_user_id
       and revoked_at is null
       and expires_at > now();
  end if;
  return new;
end;
$$;
revoke all on function public.training_pupils_mentor_change_ends_passes() from public, anon, authenticated;

drop trigger if exists training_pupils_mentor_change_ends_passes on public.training_pupils;
create trigger training_pupils_mentor_change_ends_passes
  after update of mentor_user_id on public.training_pupils
  for each row execute function public.training_pupils_mentor_change_ends_passes();

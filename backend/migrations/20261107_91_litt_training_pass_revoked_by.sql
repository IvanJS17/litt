-- Migration date: 2026-11-07
--
-- LiTT training layer 2 (docs/training.md): who ends an urgency pass when
-- the pupil's mentor changes.
--
-- 20261107_90 revoked the pupil's passes in force with revoked_by =
-- new.assigned_by. That names the right person only when the statement that
-- changes the mentor also writes assigned_by; one that does not would put the
-- revocation on the previous assigner, or on nobody. Now:
--
-- 1. The session's user (auth.uid()), when the statement runs in one, is who
--    revoked the passes.
-- 2. Without a session (the service role, which is how the app writes), it is
--    the assigned_by of the new row. The app's only path that changes a
--    mentor (assignPupil in modules/training) writes assigned_by = the actor
--    in that same UPDATE, and any other service-role path must do the same.
-- 3. With neither, the change fails (SQLSTATE LT003) instead of writing a
--    revocation that nobody made.
--
-- Safe to re-run: create or replace.

create or replace function public.training_pupils_mentor_change_ends_passes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
begin
  if new.mentor_user_id is distinct from old.mentor_user_id then
    actor := coalesce(auth.uid(), new.assigned_by);
    if actor is null then
      raise exception 'A mentor change must say who made it (assigned_by)'
        using errcode = 'LT003';
    end if;
    update public.training_urgency_passes
       set revoked_at = now(), revoked_by = actor
     where org_id = new.org_id
       and trainee_user_id = new.trainee_user_id
       and revoked_at is null
       and expires_at > now();
  end if;
  return new;
end;
$$;
revoke all on function public.training_pupils_mentor_change_ends_passes() from public, anon, authenticated;

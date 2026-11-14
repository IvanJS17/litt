-- Migration date: 2026-11-13
--
-- An owner or admin can be a mentor but never a pupil (docs/training.md).
-- Taking a pupil already refuses them (assignPupil), but a pupil who is later
-- promoted kept the row, with their stages. This trigger ends the training in
-- that organization in the same statement as the role change, whatever path
-- made it: the pupil row goes and the stages go with it (on delete cascade).
-- Their other learning data (notes, readings) stays, as it does when a pupil
-- is released. A mentor who is promoted stays a mentor.
--
-- One insert-only audit event records it. The trigger does not know who made
-- the change, so the event is filed under the promoted person, with ids only.

create or replace function public.org_members_training_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ended int;
begin
  if new.role not in ('owner', 'admin') or new.role is not distinct from old.role then
    return new;
  end if;
  with gone as (
    delete from public.training_pupils
      where org_id = new.org_id and trainee_user_id = new.user_id
      returning 1
  )
  select count(*) into ended from gone;
  if ended > 0 then
    insert into public.audit_events(user_id, org_id, action, surface, detail)
    values (new.user_id, new.org_id, 'training.pupil_ended_by_role', 'organization',
      jsonb_build_object('org_id', new.org_id, 'target_user_id', new.user_id,
        'previous_role', old.role, 'role', new.role));
  end if;
  return new;
end;
$$;
revoke all on function public.org_members_training_role_change() from public, anon, authenticated;

drop trigger if exists org_members_training_role_change on public.org_members;
create trigger org_members_training_role_change
  after update of role on public.org_members
  for each row execute procedure public.org_members_training_role_change();

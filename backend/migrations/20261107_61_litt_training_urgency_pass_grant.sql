-- Migration date: 2026-11-07
--
-- LiTT training layer 2 (docs/training.md): granting an urgency pass.
--
-- training_grant_urgency_pass is the one way a pass row is created. It
-- admits the pupil's CURRENT mentor only (the learning-data rule, minus the
-- pupil themself: training_can_read_learning and p_actor <> p_trainee), for
-- a project of that organization, and counts the passes in force under a
-- lock on the pupil's row, so two grants at once cannot both pass the limit.
-- The end is rounded down to the minute: a double submission of the same
-- grant finds the first one and is refused as a duplicate.
--
-- The duration and the limit are product parameters kept in code
-- (backend/src/lib/trainingPass.ts) and passed in; the function only refuses
-- a duration that is not positive. It returns {"outcome": ...} and, when
-- granted, the row as "pass". Only the backend (service_role) may call it.

create or replace function public.training_grant_urgency_pass(
  p_actor uuid,
  p_org uuid,
  p_trainee uuid,
  p_project uuid,
  p_duration_minutes integer,
  p_reason_code text,
  p_reason_note text,
  p_max_active integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz;
  v_row public.training_urgency_passes;
begin
  if p_actor is null or p_actor = p_trainee
    or not coalesce(public.training_can_read_learning(p_actor, p_org, p_trainee), false) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.training_pupils p
    where p.org_id = p_org and p.trainee_user_id = p_trainee and p.mentor_user_id = p_actor
    for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if not exists (
    select 1 from public.projects pr
    where pr.id = p_project and pr.org_id = p_org and pr.archived_at is null
  ) then
    return jsonb_build_object('outcome', 'project_not_found');
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    return jsonb_build_object('outcome', 'invalid_duration');
  end if;
  v_expires := date_trunc('minute', v_now + make_interval(mins => p_duration_minutes));
  if exists (
    select 1 from public.training_urgency_passes u
    where u.org_id = p_org and u.trainee_user_id = p_trainee and u.project_id = p_project
      and u.revoked_at is null and u.expires_at = v_expires
  ) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if (
    select count(*) from public.training_urgency_passes u
    where u.org_id = p_org and u.trainee_user_id = p_trainee
      and u.revoked_at is null and u.starts_at <= v_now and u.expires_at > v_now
  ) >= p_max_active then
    return jsonb_build_object('outcome', 'limit');
  end if;
  insert into public.training_urgency_passes(
    org_id, trainee_user_id, project_id, granted_by, starts_at, expires_at, reason_code, reason_note
  ) values (
    p_org, p_trainee, p_project, p_actor, v_now, v_expires, p_reason_code, p_reason_note
  )
  returning * into v_row;
  return jsonb_build_object('outcome', 'granted', 'pass', to_jsonb(v_row));
end;
$$;

revoke all on function public.training_grant_urgency_pass(uuid, uuid, uuid, uuid, integer, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.training_grant_urgency_pass(uuid, uuid, uuid, uuid, integer, text, text, integer)
  to service_role;

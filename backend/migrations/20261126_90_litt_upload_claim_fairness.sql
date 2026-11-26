-- Migration date: 2026-11-26
--
-- claim_upload_processing_job leaves accounts already at their running cap
-- out of the candidate window BEFORE its limit, so one account's queue no
-- longer hides another account's job from every worker.
--
-- Safe to re-run: create or replace.

create or replace function public.claim_upload_processing_job(
  target_worker_id text,
  target_lease_seconds integer default 600,
  target_max_running_per_user integer default 4
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_ids uuid[];
  capped_user_ids uuid[];
  candidate record;
  active_user_jobs integer;
  claimed_job_id uuid;
  claimed_session_id uuid;
  claimed_file_id uuid;
begin
  if length(target_worker_id) not between 1 and 200
     or target_lease_seconds not between 60 and 3600
     or target_max_running_per_user not between 1 and 64 then
    raise exception using errcode = '22023', message = 'invalid_upload_worker_claim';
  end if;

  -- Bound the candidate set BEFORE the per-row fairness work. The lateral
  -- running-count below sits under a sort, so without this cap every ready
  -- job pays a count on every poll of every worker even when nothing is
  -- claimable — one 50-file batch meant 50 lateral counts x 16 workers x 1/s.
  -- 32 candidates is plenty: a worker claims at most one job per poll.
  -- Accounts already at their running cap are left out BEFORE the limit, so
  -- their queue never fills the window and hides another account's job.
  select coalesce(array_agg(capped.user_id), '{}'::uuid[])
    into capped_user_ids
  from (
    select running_job.user_id
    from public.upload_processing_jobs as running_job
    where running_job.status = 'running'
      and running_job.locked_at >
        now() - make_interval(secs => target_lease_seconds)
    group by running_job.user_id
    having count(*) >= target_max_running_per_user
  ) as capped;

  select array_agg(id)
    into candidate_ids
  from (
    select id
    from public.upload_processing_jobs
    where attempts < 3
      and user_id <> all(capped_user_ids)
      and ((
        status = 'queued'
        and available_at <= now()
      ) or (
        status = 'running'
        and locked_at <= now() - make_interval(secs => target_lease_seconds)
      ))
    order by available_at, created_at
    limit 32
  ) as ready;

  if candidate_ids is null then
    return null;
  end if;

  for candidate in
    select
      job.id,
      job.session_id,
      job.file_id,
      job.user_id,
      active.running_count
    from public.upload_processing_jobs as job
    cross join lateral (
      select count(*)::integer as running_count
      from public.upload_processing_jobs as running_job
      where running_job.user_id = job.user_id
        and running_job.status = 'running'
        and running_job.locked_at >
          now() - make_interval(secs => target_lease_seconds)
    ) as active
    where job.id = any(candidate_ids)
      and job.attempts < 3
      and active.running_count < target_max_running_per_user
      and ((
        job.status = 'queued'
        and job.available_at <= now()
      ) or (
        job.status = 'running'
        and job.locked_at <=
          now() - make_interval(secs => target_lease_seconds)
      ))
    order by active.running_count, job.available_at, job.created_at
    for update of job skip locked
  loop
    -- Serialize the count-and-claim decision for this user across every
    -- backend replica. A hash collision only delays a claim until the next
    -- poll; it cannot let a user exceed the cap.
    if not pg_try_advisory_xact_lock(
      hashtextextended(candidate.user_id::text, 8242026)
    ) then
      continue;
    end if;

    select count(*)::integer
      into active_user_jobs
    from public.upload_processing_jobs
    where user_id = candidate.user_id
      and status = 'running'
      and locked_at > now() - make_interval(secs => target_lease_seconds);

    if active_user_jobs >= target_max_running_per_user then
      continue;
    end if;

    claimed_job_id := candidate.id;
    claimed_session_id := candidate.session_id;
    claimed_file_id := candidate.file_id;
    exit;
  end loop;

  if claimed_job_id is null then
    return null;
  end if;

  update public.upload_processing_jobs
  set status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = target_worker_id,
      error_code = null,
      updated_at = now()
  where id = claimed_job_id;

  update public.upload_session_files
  set status = 'processing', error_code = null, updated_at = now()
  where id = claimed_file_id
    and session_id = claimed_session_id
    and (status = 'uploaded' or (status = 'error' and error_code = 'processing_failed'));

  perform public.refresh_upload_session_status(claimed_session_id);

  return claimed_job_id;
end;
$$;

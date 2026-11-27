-- claim_upload_processing_job: an account that already runs as many upload
-- jobs as the cap allows does not wait behind another account's queue, however
-- many jobs it has waiting ahead of it. Synthetic rows, rolled back.
begin;

insert into auth.users(id, email) values
  ('d3000000-0000-4000-8000-0000000000a1', 'queue-a@example.test'),
  ('d3000000-0000-4000-8000-0000000000b1', 'queue-b@example.test');

-- ---------------------------------------------------------------------------
-- 1. Upload claims
-- ---------------------------------------------------------------------------
insert into upload_sessions(id, user_id, purpose, destination, expected_file_count, expected_total_bytes, status, expires_at) values
  ('d3000000-0000-4000-8000-0000000000e1', 'd3000000-0000-4000-8000-0000000000a1', 'document_create', '{}', 50, 1000000, 'processing', now() + interval '1 day'),
  ('d3000000-0000-4000-8000-0000000000e2', 'd3000000-0000-4000-8000-0000000000b1', 'document_create', '{}', 1, 1000, 'processing', now() + interval '1 day');
insert into upload_session_files(id, session_id, resource_id, client_id, filename, file_type, content_type, expected_size_bytes, staging_storage_path, sealed_storage_path, status)
  select gen_random_uuid(), 'd3000000-0000-4000-8000-0000000000e1', gen_random_uuid(), 'a' || g, 'a' || g || '.pdf', 'pdf', 'application/pdf', 1000, 'stg/a' || g, 'sealed/a' || g, 'uploaded'
  from generate_series(1, 34) g;
insert into upload_session_files(id, session_id, resource_id, client_id, filename, file_type, content_type, expected_size_bytes, staging_storage_path, sealed_storage_path, status)
  values (gen_random_uuid(), 'd3000000-0000-4000-8000-0000000000e2', gen_random_uuid(), 'b1', 'b1.pdf', 'pdf', 'application/pdf', 1000, 'stg/b1', 'sealed/b1', 'uploaded');
-- Account A: 2 running (fresh lease) and 32 queued, all older than B's one job.
insert into upload_processing_jobs(session_id, file_id, user_id, status, attempts, available_at, locked_at, locked_by, created_at)
  select f.session_id, f.id, 'd3000000-0000-4000-8000-0000000000a1',
    case when row_number() over (order by f.client_id) <= 2 then 'running' else 'queued' end,
    case when row_number() over (order by f.client_id) <= 2 then 1 else 0 end,
    now() - interval '10 minutes',
    case when row_number() over (order by f.client_id) <= 2 then now() end,
    'w0', now() - interval '10 minutes'
  from upload_session_files f where f.session_id = 'd3000000-0000-4000-8000-0000000000e1';
insert into upload_processing_jobs(session_id, file_id, user_id, status, available_at, created_at)
  select f.session_id, f.id, 'd3000000-0000-4000-8000-0000000000b1', 'queued', now() - interval '1 second', now() - interval '1 second'
  from upload_session_files f where f.session_id = 'd3000000-0000-4000-8000-0000000000e2';

do $$
declare claimed uuid; claimed_user uuid;
begin
  -- Account A is at its cap of 2: the next claim is B's job.
  claimed := public.claim_upload_processing_job('w1', 1800, 2);
  select user_id into claimed_user from public.upload_processing_jobs where id = claimed;
  if claimed is null or claimed_user is distinct from 'd3000000-0000-4000-8000-0000000000b1' then
    raise exception 'an account at its cap must not hold up another account (claimed user: %)', claimed_user;
  end if;
  -- Nothing else is claimable: A is still at its cap, B has its job running.
  if public.claim_upload_processing_job('w2', 1800, 2) is not null then
    raise exception 'an account at its cap must not be served';
  end if;
  -- Below its cap A is served from its own queue, oldest first.
  update public.upload_processing_jobs set status = 'completed'
    where id = (select id from public.upload_processing_jobs
                where user_id = 'd3000000-0000-4000-8000-0000000000a1' and status = 'running' limit 1);
  claimed := public.claim_upload_processing_job('w3', 1800, 2);
  select user_id into claimed_user from public.upload_processing_jobs where id = claimed;
  if claimed_user is distinct from 'd3000000-0000-4000-8000-0000000000a1' then
    raise exception 'an account below its cap must be served (claimed user: %)', claimed_user;
  end if;
end;
$$;

rollback;

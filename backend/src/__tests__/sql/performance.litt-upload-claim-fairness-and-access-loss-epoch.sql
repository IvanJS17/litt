-- Two database-level guarantees, each asserted on synthetic rows and rolled back.
--
-- 1. claim_upload_processing_job: an account that already runs as many upload
--    jobs as the cap allows does not wait behind another account's queue, however
--    many jobs it has waiting ahead of it.
-- 2. The organization's authorization epoch moves when a person is denied a
--    project, when a person's grant on a project is removed and when a project
--    becomes private, so work queued before any of them is refused when it
--    runs; it does not move for changes that only widen access, nor for
--    another organization.
begin;

insert into auth.users(id, email) values
  ('d3000000-0000-4000-8000-0000000000a1', 'queue-a@example.test'),
  ('d3000000-0000-4000-8000-0000000000b1', 'queue-b@example.test'),
  ('d3000000-0000-4000-8000-0000000000c1', 'owner@example.test'),
  ('d3000000-0000-4000-8000-0000000000c2', 'x@example.test'),
  ('d3000000-0000-4000-8000-0000000000c3', 'y@example.test'),
  ('d3000000-0000-4000-8000-0000000000c4', 'z@example.test'),
  ('d3000000-0000-4000-8000-0000000000c5', 'denied@example.test'),
  ('d3000000-0000-4000-8000-0000000000c6', 'other-owner@example.test');

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

-- ---------------------------------------------------------------------------
-- 2. The authorization epoch: setup
-- ---------------------------------------------------------------------------
insert into organizations(id, name, created_by) values
  ('d3000000-0000-4000-8000-0000000000f1', 'Firm D3', 'd3000000-0000-4000-8000-0000000000c1'),
  ('d3000000-0000-4000-8000-0000000000f2', 'Other Firm D3', 'd3000000-0000-4000-8000-0000000000c6');
insert into org_members(org_id, user_id, role) values
  ('d3000000-0000-4000-8000-0000000000f1', 'd3000000-0000-4000-8000-0000000000c1', 'owner'),
  ('d3000000-0000-4000-8000-0000000000f1', 'd3000000-0000-4000-8000-0000000000c2', 'member'),
  ('d3000000-0000-4000-8000-0000000000f1', 'd3000000-0000-4000-8000-0000000000c3', 'member'),
  ('d3000000-0000-4000-8000-0000000000f1', 'd3000000-0000-4000-8000-0000000000c4', 'member'),
  ('d3000000-0000-4000-8000-0000000000f1', 'd3000000-0000-4000-8000-0000000000c5', 'member'),
  ('d3000000-0000-4000-8000-0000000000f2', 'd3000000-0000-4000-8000-0000000000c6', 'owner')
  on conflict do nothing;
insert into projects(id, user_id, org_id, name, visibility) values
  ('d3000000-0000-4000-8000-000000000a02', 'd3000000-0000-4000-8000-0000000000c1', 'd3000000-0000-4000-8000-0000000000f1', 'P2', 'organization');

-- ---------------------------------------------------------------------------
-- 2b. The authorization epoch: assertions
-- ---------------------------------------------------------------------------
create function pg_temp.epoch(p_org text) returns bigint language sql as $$
  select authorization_epoch from public.organizations where id = p_org::uuid;
$$;

do $$
declare
  firm text := 'd3000000-0000-4000-8000-0000000000f1';
  other text := 'd3000000-0000-4000-8000-0000000000f2';
  before_epoch bigint; other_epoch bigint;
begin
  before_epoch := pg_temp.epoch(firm);
  other_epoch := pg_temp.epoch(other);

  -- Denying one person bumps the epoch of that organization once.
  insert into public.project_org_access_overrides(project_id, org_id, user_id, role)
    values ('d3000000-0000-4000-8000-000000000a02', firm::uuid, 'd3000000-0000-4000-8000-0000000000c5', 'deny');
  if pg_temp.epoch(firm) is distinct from before_epoch + 1 then
    raise exception 'a deny override must move the epoch once (% -> %)', before_epoch, pg_temp.epoch(firm);
  end if;
  before_epoch := pg_temp.epoch(firm);

  -- A project becoming private moves it.
  update public.projects set visibility = 'private' where id = 'd3000000-0000-4000-8000-000000000a02';
  if pg_temp.epoch(firm) is distinct from before_epoch + 1 then
    raise exception 'a project becoming private must move the epoch once (% -> %)', before_epoch, pg_temp.epoch(firm);
  end if;
  before_epoch := pg_temp.epoch(firm);

  -- Changes that only widen access, or touch nothing about access, do not.
  update public.projects set visibility = 'organization' where id = 'd3000000-0000-4000-8000-000000000a02';
  update public.projects set name = 'P2 renamed' where id = 'd3000000-0000-4000-8000-000000000a02';
  insert into public.project_org_access_overrides(project_id, org_id, user_id, role)
    values ('d3000000-0000-4000-8000-000000000a02', firm::uuid, 'd3000000-0000-4000-8000-0000000000c4', 'editor');
  delete from public.project_org_access_overrides
    where project_id = 'd3000000-0000-4000-8000-000000000a02' and user_id = 'd3000000-0000-4000-8000-0000000000c5';
  if pg_temp.epoch(firm) is distinct from before_epoch then
    raise exception 'changes that only widen access must not move the epoch (% -> %)', before_epoch, pg_temp.epoch(firm);
  end if;

  -- Another organization is never touched by any of this.
  if pg_temp.epoch(other) is distinct from other_epoch then
    raise exception 'the epoch of another organization must not move';
  end if;

  -- Removing a person's grant moves it once; removing a deny does not.
  before_epoch := pg_temp.epoch(firm);
  insert into public.project_org_access_overrides(project_id, org_id, user_id, role)
    values ('d3000000-0000-4000-8000-000000000a02', firm::uuid, 'd3000000-0000-4000-8000-0000000000c5', 'viewer');
  delete from public.project_org_access_overrides
    where project_id = 'd3000000-0000-4000-8000-000000000a02' and user_id = 'd3000000-0000-4000-8000-0000000000c5';
  if pg_temp.epoch(firm) is distinct from before_epoch + 1 then
    raise exception 'removing a grant must move the epoch once (% -> %)', before_epoch, pg_temp.epoch(firm);
  end if;
  before_epoch := pg_temp.epoch(firm);
  delete from public.project_org_access_overrides
    where project_id = 'd3000000-0000-4000-8000-000000000a02' and role = 'deny';
  if pg_temp.epoch(firm) is distinct from before_epoch then
    raise exception 'removing a deny only widens access and must not move the epoch';
  end if;

  -- A deny written over an existing override also moves it.
  update public.project_org_access_overrides set role = 'deny'
    where project_id = 'd3000000-0000-4000-8000-000000000a02' and user_id = 'd3000000-0000-4000-8000-0000000000c4';
  if pg_temp.epoch(firm) is distinct from before_epoch + 1 then
    raise exception 'turning an override into a deny must move the epoch once';
  end if;

  -- One statement removing several grants moves it once.
  before_epoch := pg_temp.epoch(firm);
  insert into public.project_org_access_overrides(project_id, org_id, user_id, role) values
    ('d3000000-0000-4000-8000-000000000a02', firm::uuid, 'd3000000-0000-4000-8000-0000000000c2', 'viewer'),
    ('d3000000-0000-4000-8000-000000000a02', firm::uuid, 'd3000000-0000-4000-8000-0000000000c3', 'viewer');
  delete from public.project_org_access_overrides
    where project_id = 'd3000000-0000-4000-8000-000000000a02' and role = 'viewer';
  if pg_temp.epoch(firm) is distinct from before_epoch + 1 then
    raise exception 'removing several grants in one statement must move the epoch once (% -> %)', before_epoch, pg_temp.epoch(firm);
  end if;
end;
$$;

rollback;

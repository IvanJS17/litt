-- LiTT training layer 2 (20261107_61_litt_training_urgency_pass_grant.sql):
-- who can grant an urgency pass, and what the grant refuses.
--
--   1. training_grant_urgency_pass, actor by actor: only the pupil's CURRENT
--      mentor grants; the pupil, a previous mentor, another mentor, the
--      owner, an admin, another member, another pupil, a member of another
--      firm and an unknown id get not_found and write nothing.
--   2. The pass is for a live project of the same firm.
--   3. A double submission is a duplicate; at most p_max_active passes are
--      in force (revoked and expired ones do not count).
--   4. A pupil who left the firm gets no pass; a non-positive duration is
--      refused; the browser roles cannot call the function.
--   5. A pass ends when the pupil's mentor changes
--      (20261107_90_litt_training_defense_outcome.sql): every pass in force
--      is revoked by whoever moved the pupil; ended ones and other pupils'
--      are untouched; the new mentor can grant again.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingUrgencyPass.postgres.test.ts runs it locally
-- against a disposable database and proves it fails with a grant function
-- that also lets an owner grant.

create temporary table litt_pass_actors(label text primary key, uid uuid not null);

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  project uuid := gen_random_uuid(); other_project uuid := gen_random_uuid();
  archived uuid := gen_random_uuid();
  a record;
begin
  delete from litt_pass_actors;
  insert into litt_pass_actors(label, uid) select l, gen_random_uuid() from unnest(array[
    'owner','admin','mentor','old_mentor','other_mentor','member','pupil','other_pupil','outsider','ghost']) l;
  for a in select * from litt_pass_actors where label <> 'ghost' loop
    insert into auth.users(id, email) values (a.uid, a.uid || '@example.test');
    perform set_config('litt.' || a.label, a.uid::text, true);
  end loop;
  perform set_config('litt.ghost', (select uid::text from litt_pass_actors where label = 'ghost'), true);
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', current_setting('litt.owner')::uuid),
    (other_org, 'Other synthetic firm', current_setting('litt.outsider')::uuid);
  insert into public.org_members(org_id, user_id, role)
    select org, uid, case label when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end
    from litt_pass_actors where label not in ('outsider', 'ghost');
  insert into public.org_members(org_id, user_id, role)
    values (other_org, current_setting('litt.outsider')::uuid, 'owner');
  insert into public.training_mentors(org_id, user_id, designated_by)
    select org, uid, current_setting('litt.owner')::uuid from litt_pass_actors
    where label in ('mentor', 'old_mentor', 'other_mentor');
  -- The pupil had old_mentor, now has mentor.
  insert into public.training_pupils(org_id, trainee_user_id, mentor_user_id, assigned_by) values
    (org, current_setting('litt.pupil')::uuid, current_setting('litt.old_mentor')::uuid, current_setting('litt.old_mentor')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, current_setting('litt.other_mentor')::uuid, current_setting('litt.other_mentor')::uuid);
  update public.training_pupils set mentor_user_id = current_setting('litt.mentor')::uuid
    where trainee_user_id = current_setting('litt.pupil')::uuid;
  insert into public.projects(id, user_id, org_id, name, visibility) values
    (project, current_setting('litt.owner')::uuid, org, 'Synthetic matter', 'organization'),
    (other_project, current_setting('litt.outsider')::uuid, other_org, 'Other firm''s matter', 'organization');
  insert into public.projects(id, user_id, org_id, name, visibility, archived_at)
    values (archived, current_setting('litt.owner')::uuid, org, 'Archived matter', 'organization', now());
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.project', project::text, true);
  perform set_config('litt.other_project', other_project::text, true);
  perform set_config('litt.archived', archived::text, true);
end;
$$;

-- One grant by p_actor to the pupil: its outcome.
create function pg_temp.grant_by(p_actor text, p_minutes int default 480,
    p_project text default 'project', p_trainee text default 'pupil', p_max int default 5)
returns text language sql as $$
  select public.training_grant_urgency_pass(
    current_setting('litt.' || p_actor)::uuid, current_setting('litt.org')::uuid,
    current_setting('litt.' || p_trainee)::uuid, current_setting('litt.' || p_project)::uuid,
    p_minutes, 'plazo', 'nota libre', p_max) ->> 'outcome';
$$;

-- 1. Only the current mentor grants.
begin;
select pg_temp.fixture();
do $$
declare got text; wrong text := '';
  a record;
begin
  for a in select label from litt_pass_actors where label <> 'mentor' order by label loop
    got := pg_temp.grant_by(a.label);
    if got is distinct from 'not_found' then wrong := wrong || format('%s got %s; ', a.label, got); end if;
  end loop;
  assert wrong = '', 'grant matrix: ' || wrong;
  assert (select count(*) from public.training_urgency_passes) = 0, 'a refused grant writes nothing';
  assert pg_temp.grant_by('mentor') = 'granted', 'grant matrix: the current mentor grants';
  assert (select count(*) from public.training_urgency_passes) = 1, 'one grant, one row';
  assert (select granted_by = current_setting('litt.mentor')::uuid and reason_code = 'plazo'
      and reason_note = 'nota libre' and revoked_at is null
      and expires_at = date_trunc('minute', starts_at + interval '480 minutes')
    from public.training_urgency_passes), 'the row records the grant';
  -- Another pupil's mentor grants to their own pupil, not to this one.
  assert pg_temp.grant_by('other_mentor', 60, 'project', 'other_pupil') = 'granted',
    'grant matrix: other_mentor grants to their own pupil';
  assert pg_temp.grant_by('mentor', 60, 'project', 'other_pupil') = 'not_found',
    'grant matrix: mentor does not grant to another mentor''s pupil';
end;
$$;
rollback;

-- 2. The project: live and of the same firm.
begin;
select pg_temp.fixture();
do $$
begin
  assert pg_temp.grant_by('mentor', 480, 'other_project') = 'project_not_found', 'another firm''s project';
  assert pg_temp.grant_by('mentor', 480, 'archived') = 'project_not_found', 'an archived project';
  assert (select count(*) from public.training_urgency_passes) = 0, 'no row for a refused project';
end;
$$;
rollback;

-- 3. Duplicates and the limit.
begin;
select pg_temp.fixture();
do $$
declare i int;
begin
  -- now() is fixed inside a transaction: the same call twice is a double submission.
  assert pg_temp.grant_by('mentor', 60) = 'granted', 'first grant';
  assert pg_temp.grant_by('mentor', 60) = 'duplicate', 'a double submission is refused';
  for i in 2..5 loop
    assert pg_temp.grant_by('mentor', 60 * i) = 'granted', format('grant %s of 5', i);
  end loop;
  assert pg_temp.grant_by('mentor', 600) = 'limit', 'a sixth pass in force is refused';
  update public.training_urgency_passes set revoked_at = now(), revoked_by = current_setting('litt.mentor')::uuid
    where expires_at = (select min(expires_at) from public.training_urgency_passes);
  assert pg_temp.grant_by('mentor', 600) = 'granted', 'a revoked pass does not count';
  update public.training_urgency_passes set starts_at = now() - interval '2 days', expires_at = now() - interval '1 day'
    where reason_code = 'plazo' and revoked_at is null
      and expires_at = (select min(expires_at) from public.training_urgency_passes where revoked_at is null);
  assert pg_temp.grant_by('mentor', 660) = 'granted', 'an expired pass does not count';
  assert pg_temp.grant_by('mentor', 720) = 'limit', 'the limit holds again';
end;
$$;
rollback;

-- 4. A pupil who left, a bad duration, and the browser roles.
begin;
select pg_temp.fixture();
do $$
begin
  assert pg_temp.grant_by('mentor', 0) = 'invalid_duration', 'a duration of zero';
  assert not has_function_privilege('authenticated',
      'public.training_grant_urgency_pass(uuid,uuid,uuid,uuid,integer,text,text,integer)', 'execute')
    and not has_function_privilege('anon',
      'public.training_grant_urgency_pass(uuid,uuid,uuid,uuid,integer,text,text,integer)', 'execute'),
    'the grant is not callable by the browser roles';
  assert has_function_privilege('service_role',
      'public.training_grant_urgency_pass(uuid,uuid,uuid,uuid,integer,text,text,integer)', 'execute'),
    'the backend calls the grant';
  delete from public.org_members where user_id = current_setting('litt.pupil')::uuid
    and org_id = current_setting('litt.org')::uuid;
  assert pg_temp.grant_by('mentor') = 'not_found', 'a pupil who left the firm';
end;
$$;
rollback;

-- 5. A pass ends when the pupil's mentor changes.
begin;
select pg_temp.fixture();
do $$
declare pupil uuid := current_setting('litt.pupil')::uuid;
  admin uuid := current_setting('litt.admin')::uuid;
begin
  assert pg_temp.grant_by('mentor', 60) = 'granted', 'a pass in force';
  assert pg_temp.grant_by('mentor', 120) = 'granted', 'a second pass in force';
  assert pg_temp.grant_by('other_mentor', 60, 'project', 'other_pupil') = 'granted', 'another pupil''s pass';
  -- An ended pass keeps its own end.
  insert into public.training_urgency_passes(org_id, trainee_user_id, project_id, granted_by,
      starts_at, expires_at, reason_code)
    values (current_setting('litt.org')::uuid, pupil, current_setting('litt.project')::uuid,
      current_setting('litt.mentor')::uuid, now() - interval '2 days', now() - interval '1 day', 'otro');
  -- Changing anything but the mentor ends nothing.
  update public.training_pupils set updated_at = now() where trainee_user_id = pupil;
  assert (select count(*) from public.training_urgency_passes where revoked_at is not null) = 0,
    'no mentor change, no revocation';
  update public.training_pupils
     set mentor_user_id = current_setting('litt.old_mentor')::uuid, assigned_by = admin, updated_at = now()
   where trainee_user_id = pupil;
  assert (select count(*) from public.training_urgency_passes
    where trainee_user_id = pupil and expires_at > now() and revoked_at is null) = 0,
    'the new mentor finds no pass of the old one in force';
  assert (select count(*) from public.training_urgency_passes
    where trainee_user_id = pupil and revoked_at is not null and revoked_by = admin) = 2,
    'the passes in force end, revoked by whoever moved the pupil';
  assert (select revoked_at is null from public.training_urgency_passes
    where trainee_user_id = pupil and expires_at < now()), 'an ended pass is left as it was';
  assert (select revoked_at is null from public.training_urgency_passes
    where trainee_user_id = current_setting('litt.other_pupil')::uuid), 'another pupil''s pass stays';
  assert pg_temp.grant_by('mentor', 60) = 'not_found', 'the former mentor grants no more';
  assert pg_temp.grant_by('old_mentor', 60) = 'granted', 'the new mentor grants';
end;
$$;
rollback;

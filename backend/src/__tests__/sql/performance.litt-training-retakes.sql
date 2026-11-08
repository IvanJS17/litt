-- LiTT training layer 3, own map and retake
-- (20261108_78_litt_training_retakes.sql): the learning rule on the new table
-- and its own constraints.
--
--   1. training_can_read_learning on a retake, actor by actor: the person and
--      their current mentor read; a previous mentor, another mentor, the owner,
--      an admin, another pupil, a member of another firm and an unknown id do
--      not. Reassigning the mentor moves the access, not the row.
--   2. The table is closed to the browser roles and has RLS.
--   3. Leaving the firm, and erasing the account, leave no retake behind; the
--      audit event stays.
--   4. Constraints: closed statuses, a question before it is open, an answer
--      with its contrast, verdict and date together and written once, a route
--      of three columns or none, one retake pending or open per person and firm.
--   4b. source_note_ids: never null, empty by default, kept across a re-run.
--   5. The migration re-runs over the final shape.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingRetakes.postgres.test.ts runs it locally.
-- The generic discovery of every training_* table is in
-- performance.litt-training-supervision.sql, whose fixture has a retake too.

create temporary table litt_retake_actors(label text primary key, uid uuid not null);

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  a record;
begin
  delete from litt_retake_actors;
  insert into litt_retake_actors(label, uid) select l, gen_random_uuid() from unnest(array[
    'owner','admin','mentor_a','mentor_b','pupil','other_pupil','outsider','ghost']) l;
  for a in select * from litt_retake_actors where label <> 'ghost' loop
    insert into auth.users(id, email) values (a.uid, a.uid || '@example.test');
    perform set_config('litt.' || a.label, a.uid::text, true);
  end loop;
  perform set_config('litt.ghost', (select uid::text from litt_retake_actors where label = 'ghost'), true);
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', current_setting('litt.owner')::uuid),
    (other_org, 'Other synthetic firm', current_setting('litt.outsider')::uuid);
  insert into public.org_members(org_id, user_id, role)
    select org, uid, case label when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end
    from litt_retake_actors where label not in ('outsider', 'ghost');
  insert into public.org_members(org_id, user_id, role)
    values (other_org, current_setting('litt.outsider')::uuid, 'owner');
  insert into public.training_mentors(org_id, user_id, designated_by) values
    (org, current_setting('litt.mentor_a')::uuid, current_setting('litt.owner')::uuid),
    (org, current_setting('litt.mentor_b')::uuid, current_setting('litt.owner')::uuid);
  insert into public.training_pupils(org_id, trainee_user_id, mentor_user_id, assigned_by) values
    (org, current_setting('litt.pupil')::uuid, current_setting('litt.mentor_a')::uuid, current_setting('litt.mentor_a')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, current_setting('litt.mentor_b')::uuid, current_setting('litt.mentor_b')::uuid);
  insert into public.training_retakes(org_id, trainee_user_id, topic_key, topic_label)
    values (org, current_setting('litt.pupil')::uuid, 'prescripcion', 'Prescripción');
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.other_org', other_org::text, true);
end;
$$;

-- p_sql must fail, naming p_needle (constraint name or message text).
create function pg_temp.rejects(p_sql text, p_needle text) returns void language plpgsql as $$
declare rejected boolean := false; c text; m text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics c = constraint_name, m = message_text;
    rejected := true;
    if coalesce(c, '') <> p_needle and position(p_needle in m) = 0 then
      raise exception 'expected % but got % (%)', p_needle, c, m;
    end if;
  end;
  if not rejected then raise exception 'expected % to reject: %', p_needle, p_sql; end if;
end;
$$;

-- Who reads the pupil's learning data (and so their retakes), against who should.
create function pg_temp.reader_mismatches(p_readers text[]) returns text language plpgsql as $$
declare result text;
begin
  select string_agg(format('%s %s the pupil', a.label, case when x.got then 'reads' else 'does not read' end),
    '; ' order by a.label) into result
  from litt_retake_actors a
  cross join lateral (select public.training_can_read_learning(
    a.uid, current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid) got) x
  where x.got is distinct from (a.label = any(p_readers));
  return coalesce(result, '');
end;
$$;

-- 1 and 2. Who reads, the mentor change, and the browser roles.
begin;
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.reader_mismatches(array['pupil', 'mentor_a']);
  assert got = '', 'matrix: ' || got;
  update public.training_pupils set mentor_user_id = current_setting('litt.mentor_b')::uuid
    where trainee_user_id = current_setting('litt.pupil')::uuid;
  got := pg_temp.reader_mismatches(array['pupil', 'mentor_b']);
  assert got = '', 'after reassigning: ' || got;
  assert (select count(*) from public.training_retakes where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'the retake stays the pupil''s when the mentor changes';
  assert (select relrowsecurity from pg_class where oid = 'public.training_retakes'::regclass), 'RLS is on';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
      unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(r, 'public.training_retakes', p)),
    'a browser role has a privilege on training_retakes';
  assert has_table_privilege('service_role', 'public.training_retakes', 'SELECT')
    and has_table_privilege('service_role', 'public.training_retakes', 'UPDATE'), 'the backend uses the table';
  assert not exists (select 1 from pg_policies where tablename = 'training_retakes'), 'no policy opens it';
end;
$$;
rollback;

-- 3. Leaving and erasure.
begin;
select pg_temp.fixture();
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
begin
  assert (select count(*) from public.training_retakes) = 0, 'leaving the firm deletes the retake';
end;
$$;
rollback;

begin;
select pg_temp.fixture();
do $$
begin
  insert into public.audit_events(user_id, action, surface, detail)
    values (current_setting('litt.owner')::uuid, 'training.retake_generated', 'organization',
      jsonb_build_object('org_id', current_setting('litt.org'), 'target_user_id', current_setting('litt.pupil')));
end;
$$;
select public.prepare_account_org_departures(current_setting('litt.pupil')::uuid);
delete from auth.users where id = current_setting('litt.pupil')::uuid;
do $$
begin
  assert (select count(*) from public.training_retakes) = 0, 'erasing the account deletes the retake';
  assert (select count(*) from public.audit_events where action = 'training.retake_generated') = 1, 'the audit stays';
end;
$$;
rollback;

-- 4. Constraints.
begin;
select pg_temp.fixture();
do $$
declare
  me text := current_setting('litt.pupil');
  other text := current_setting('litt.other_pupil');
  org text := current_setting('litt.org');
  long_answer text := repeat('x', 61);
begin
  -- One retake pending or open at a time per person and firm; another person's is separate.
  perform pg_temp.rejects(format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label) values (%L,%L,''mora'',''Mora'')', org, me),
    'training_retakes_open_key');
  execute format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label) values (%L,%L,''mora'',''Mora'')', org, other);
  perform pg_temp.rejects(format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label) values (%L,%L,''mora'',''Mora'')',
    org, current_setting('litt.outsider')), 'training_retakes_member_fkey');
  perform pg_temp.rejects(format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label,status) values (%L,%L,''mora'',''Mora'',''hecha'')',
    org, current_setting('litt.mentor_a')), 'training_retakes_status_check');
  perform pg_temp.rejects(format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label,status) values (%L,%L,'''',''Mora'',''failed'')',
    org, current_setting('litt.mentor_a')), 'training_retakes_topic_check');
  perform pg_temp.rejects(format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label,status) values (%L,%L,%L,''Mora'',''failed'')',
    org, current_setting('litt.mentor_a'), repeat('k', 81)), 'training_retakes_topic_check');
  -- A question is needed before the retake is open, and is bounded; a route comes with it.
  perform pg_temp.rejects('update public.training_retakes set status = ''open'' where trainee_user_id = ' || quote_literal(me) || '::uuid',
    'training_retakes_question_check');
  perform pg_temp.rejects(format('update public.training_retakes set question = %L where trainee_user_id = %L::uuid', repeat('q', 601), me),
    'training_retakes_question_check');
  perform pg_temp.rejects('update public.training_retakes set status = ''open'', question = ''¿Desde cuándo?'' where trainee_user_id = ' || quote_literal(me) || '::uuid',
    'training_retakes_route_check');
  perform pg_temp.rejects('update public.training_retakes set model = ''gpt'' where trainee_user_id = ' || quote_literal(me) || '::uuid',
    'training_retakes_route_check');
  update public.training_retakes set status = 'open', question = '¿Desde cuándo corre el plazo?',
    model_provider = 'openai', model = 'gpt', credential_ref = 'user:x'
    where trainee_user_id = me::uuid;
  -- An answer comes with its contrast, verdict and date, and within bounds.
  perform pg_temp.rejects(format('update public.training_retakes set status = ''answered'', answer = %L where trainee_user_id = %L::uuid', long_answer, me),
    'training_retakes_answer_check');
  perform pg_temp.rejects(format('update public.training_retakes set status = ''answered'', answer = %L, contrast = ''c'', verdict = ''coincide'' where trainee_user_id = %L::uuid', long_answer, me),
    'training_retakes_answer_check');
  perform pg_temp.rejects(format('update public.training_retakes set status = ''answered'', answer = ''corta'', contrast = ''c'', verdict = ''coincide'', answered_at = now() where trainee_user_id = %L::uuid', me),
    'training_retakes_answer_check');
  perform pg_temp.rejects(format('update public.training_retakes set status = ''answered'', answer = %L, contrast = ''c'', verdict = ''acierto'', answered_at = now() where trainee_user_id = %L::uuid', long_answer, me),
    'training_retakes_answer_check');
  perform pg_temp.rejects(format('update public.training_retakes set status = ''answered'', answer = %L, contrast = %L, verdict = ''coincide'', answered_at = now() where trainee_user_id = %L::uuid', long_answer, repeat('c', 8001), me),
    'training_retakes_answer_check');
  perform pg_temp.rejects(format('update public.training_retakes set answer = %L, contrast = ''c'', verdict = ''coincide'', answered_at = now() where trainee_user_id = %L::uuid', long_answer, me),
    'training_retakes_answer_check');
  update public.training_retakes set status = 'answered', answer = long_answer, contrast = 'Coincide' || E'\n' || '- bien',
    verdict = 'parcial', answered_at = now()
    where trainee_user_id = me::uuid;
  assert (select count(*) from public.training_retakes where status = 'answered') = 1, 'an answered retake is accepted';
  -- What was answered cannot change afterwards: not the answer, the contrast or the verdict.
  perform pg_temp.rejects(format('update public.training_retakes set answer = %L where status = ''answered''', repeat('y', 61)),
    'A training retake''s answer is recorded once');
  perform pg_temp.rejects('update public.training_retakes set verdict = ''coincide'' where status = ''answered''',
    'A training retake''s answer is recorded once');
  perform pg_temp.rejects('update public.training_retakes set contrast = ''otro'' where status = ''answered''',
    'A training retake''s answer is recorded once');
  -- An answered retake frees the slot for the next one.
  execute format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label) values (%L,%L,''mora'',''Mora'')', org, me);
  -- A failed question keeps no question and frees the slot.
  update public.training_retakes set status = 'failed' where status = 'pending' and trainee_user_id = me::uuid;
  execute format('insert into public.training_retakes(org_id,trainee_user_id,topic_key,topic_label) values (%L,%L,''rescision'',''Rescisión'')', org, me);
  assert (select count(*) from public.training_retakes where trainee_user_id = me::uuid) = 3, 'three retakes of the pupil';
end;
$$;
rollback;

-- 4b. The source notes: an array that is never null, empty by default, kept
-- as written, and not lost when the migration runs again over rows that have it.
begin;
select pg_temp.fixture();
do $$
declare me text := current_setting('litt.pupil'); org text := current_setting('litt.org');
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
begin
  assert (select source_note_ids from public.training_retakes where trainee_user_id = me::uuid) = '{}'::uuid[],
    'a retake starts with no recorded sources';
  perform pg_temp.rejects(format('update public.training_retakes set source_note_ids = null where trainee_user_id = %L::uuid', me), 'source_note_ids');
  update public.training_retakes set source_note_ids = array[a, b] where trainee_user_id = me::uuid;
  assert (select source_note_ids from public.training_retakes where trainee_user_id = me::uuid) = array[a, b],
    'the sources are kept as written';
  perform set_config('litt.src_a', a::text, true);
end;
$$;
\ir ../../../migrations/20261108_78_litt_training_retakes.sql
do $$
begin
  assert (select source_note_ids from public.training_retakes where trainee_user_id = current_setting('litt.pupil')::uuid)
    = array[current_setting('litt.src_a')::uuid, (select source_note_ids[2] from public.training_retakes limit 1)],
    're-running the migration keeps the recorded sources';
  assert (select data_type || '/' || is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'training_retakes' and column_name = 'source_note_ids') = 'ARRAY/NO',
    'source_note_ids is a not-null array';
end;
$$;
rollback;

-- 5. The migration re-runs over the final shape, twice, and the rule holds.
begin;
\ir ../../../migrations/20261108_78_litt_training_retakes.sql
\ir ../../../migrations/20261108_78_litt_training_retakes.sql
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.reader_mismatches(array['pupil', 'mentor_a']);
  assert got = '', 'after re-running the migration: ' || got;
  assert exists (select 1 from pg_trigger where tgname = 'training_retakes_answer_once'
    and tgrelid = 'public.training_retakes'::regclass), 'the answer stays write-once';
  assert (select count(*) from pg_trigger where tgrelid = 'public.training_retakes'::regclass and not tgisinternal) = 1,
    'one trigger, not two';
end;
$$;
rollback;

-- Control: without the write-once trigger the answer could be rewritten, and the checks above would catch it.
begin;
select pg_temp.fixture();
update public.training_retakes set status = 'open', question = '¿Cuándo?', model_provider = 'o', model = 'm', credential_ref = 'c';
update public.training_retakes set status = 'answered', answer = repeat('o', 61), contrast = 'c', verdict = 'parcial', answered_at = now();
drop trigger training_retakes_answer_once on public.training_retakes;
update public.training_retakes set answer = repeat('r', 61);
do $$
begin
  assert (select answer from public.training_retakes) = repeat('r', 61),
    'control: with the trigger gone the answer can be rewritten';
end;
$$;
rollback;

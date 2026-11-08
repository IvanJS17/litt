-- LiTT training layer 3, periodic full reading
-- (20261108_68_litt_training_criterion_readings.sql): the learning rule on
-- the new table and its own constraints.
--
--   1. training_can_read_learning on a reading, actor by actor: the person and
--      their current mentor read; a previous mentor, another mentor, the owner,
--      an admin, another pupil, a member of another firm and an unknown id do
--      not. Reassigning the mentor moves the access, not the row.
--   2. The table is closed to the browser roles and has RLS.
--   3. Leaving the firm, and erasing the account, leave no reading behind;
--      deleting the document or the matter leaves it, unlinked.
--   4. Constraints: closed statuses, findings written once with their date and
--      never changed afterwards, a route of three columns or none, a compared
--      reading with both lists, one open reading per person and firm, no
--      oversized lists.
--   5. The migration re-runs over the final shape.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingReadings.postgres.test.ts runs it locally.
-- The generic discovery of every training_* table is in
-- performance.litt-training-supervision.sql, whose fixture has a reading too.

create temporary table litt_reading_actors(label text primary key, uid uuid not null);

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  project uuid := gen_random_uuid(); doc uuid := gen_random_uuid(); ver uuid := gen_random_uuid();
  a record;
begin
  delete from litt_reading_actors;
  insert into litt_reading_actors(label, uid) select l, gen_random_uuid() from unnest(array[
    'owner','admin','mentor_a','mentor_b','pupil','other_pupil','outsider','ghost']) l;
  for a in select * from litt_reading_actors where label <> 'ghost' loop
    insert into auth.users(id, email) values (a.uid, a.uid || '@example.test');
    perform set_config('litt.' || a.label, a.uid::text, true);
  end loop;
  perform set_config('litt.ghost', (select uid::text from litt_reading_actors where label = 'ghost'), true);
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', current_setting('litt.owner')::uuid),
    (other_org, 'Other synthetic firm', current_setting('litt.outsider')::uuid);
  insert into public.org_members(org_id, user_id, role)
    select org, uid, case label when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end
    from litt_reading_actors where label not in ('outsider', 'ghost');
  insert into public.org_members(org_id, user_id, role)
    values (other_org, current_setting('litt.outsider')::uuid, 'owner');
  insert into public.training_mentors(org_id, user_id, designated_by) values
    (org, current_setting('litt.mentor_a')::uuid, current_setting('litt.owner')::uuid),
    (org, current_setting('litt.mentor_b')::uuid, current_setting('litt.owner')::uuid);
  insert into public.training_pupils(org_id, trainee_user_id, mentor_user_id, assigned_by) values
    (org, current_setting('litt.pupil')::uuid, current_setting('litt.mentor_a')::uuid, current_setting('litt.mentor_a')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, current_setting('litt.mentor_b')::uuid, current_setting('litt.mentor_b')::uuid);
  insert into public.projects(id, user_id, org_id, name, visibility)
    values (project, current_setting('litt.owner')::uuid, org, 'Synthetic matter', 'organization');
  insert into public.documents(id, project_id, org_id, user_id)
    values (doc, project, org, current_setting('litt.owner')::uuid);
  insert into public.document_versions(id, document_id, filename, version_number)
    values (ver, doc, 'synthetic.docx', 1);
  insert into public.training_readings(org_id, trainee_user_id, project_id, document_id, version_id, status)
    values (org, current_setting('litt.pupil')::uuid, project, doc, ver, 'assigned');
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.other_org', other_org::text, true);
  perform set_config('litt.project', project::text, true);
  perform set_config('litt.doc', doc::text, true);
  perform set_config('litt.ver', ver::text, true);
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

-- Who reads the pupil's learning data (and so their readings), against who should.
create function pg_temp.reader_mismatches(p_readers text[]) returns text language plpgsql as $$
declare result text;
begin
  select string_agg(format('%s %s the pupil', a.label, case when x.got then 'reads' else 'does not read' end),
    '; ' order by a.label) into result
  from litt_reading_actors a
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
  assert (select count(*) from public.training_readings where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'the reading stays the pupil''s when the mentor changes';
  assert (select relrowsecurity from pg_class where oid = 'public.training_readings'::regclass), 'RLS is on';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
      unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(r, 'public.training_readings', p)),
    'a browser role has a privilege on training_readings';
  assert has_table_privilege('service_role', 'public.training_readings', 'SELECT')
    and has_table_privilege('service_role', 'public.training_readings', 'UPDATE'), 'the backend uses the table';
  assert not exists (select 1 from pg_policies where tablename = 'training_readings'), 'no policy opens it';
end;
$$;
rollback;

-- 3. Leaving, erasure, and the document going away.
begin;
select pg_temp.fixture();
do $$
begin
  delete from public.documents where id = current_setting('litt.doc')::uuid;
  assert (select count(*) from public.training_readings where document_id is null and version_id is null) = 1,
    'deleting the document keeps the reading, unlinked';
  delete from public.projects where id = current_setting('litt.project')::uuid;
  assert (select count(*) from public.training_readings where project_id is null) = 1,
    'deleting the matter keeps the reading, unlinked';
end;
$$;
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
begin
  assert (select count(*) from public.training_readings) = 0, 'leaving the firm deletes the reading';
end;
$$;
rollback;

begin;
select pg_temp.fixture();
do $$
begin
  insert into public.audit_events(user_id, action, surface, detail)
    values (current_setting('litt.owner')::uuid, 'training.reading_assigned', 'organization',
      jsonb_build_object('org_id', current_setting('litt.org'), 'target_user_id', current_setting('litt.pupil')));
end;
$$;
select public.prepare_account_org_departures(current_setting('litt.pupil')::uuid);
delete from auth.users where id = current_setting('litt.pupil')::uuid;
do $$
begin
  assert (select count(*) from public.training_readings) = 0, 'erasing the account deletes the reading';
  assert (select count(*) from public.audit_events where action = 'training.reading_assigned') = 1, 'the audit stays';
end;
$$;
rollback;

-- 4. Constraints.
begin;
select pg_temp.fixture();
do $$
declare
  me text := current_setting('litt.pupil');
  org text := current_setting('litt.org');
  v_machine text := '[{"text":"Falta la fecha","excerpt":"sin fecha de vencimiento"}]';
  v_comparison text := '{"person_items":["a"],"both":[],"only_person":[0],"only_machine":[0],"discarded":0}';
  route text := '''openai'',''gpt'',''user:x''';
begin
  -- One reading open at a time per person and firm; another person's is separate.
  perform pg_temp.rejects(format('insert into public.training_readings(org_id,trainee_user_id) values (%L,%L)', org, me),
    'training_readings_open_key');
  execute format('insert into public.training_readings(org_id,trainee_user_id) values (%L,%L)', org,
    current_setting('litt.other_pupil'));
  perform pg_temp.rejects(format('insert into public.training_readings(org_id,trainee_user_id) values (%L,%L)', org,
    current_setting('litt.outsider')), 'training_readings_member_fkey');
  perform pg_temp.rejects(format('insert into public.training_readings(org_id,trainee_user_id,status,findings,submitted_at) values (%L,%L,''leida'',''algo'',now())',
    org, current_setting('litt.other_pupil')), 'training_readings_status_check');
  -- Findings and their date come together, and only once a reading is sent.
  perform pg_temp.rejects('update public.training_readings set findings = ''algo'' where status = ''assigned''',
    'training_readings_findings_check');
  perform pg_temp.rejects('update public.training_readings set status = ''submitted'' where status = ''assigned''',
    'training_readings_findings_check');
  perform pg_temp.rejects('update public.training_readings set status = ''submitted'', findings = ''algo'' where status = ''assigned''',
    'training_readings_findings_check');
  perform pg_temp.rejects(format('update public.training_readings set status = ''submitted'', findings = %L, submitted_at = now() where status = ''assigned''',
    repeat('x', 4001)), 'training_readings_findings_check');
  update public.training_readings set status = 'submitted', findings = 'Lo que encontré', submitted_at = now()
    where trainee_user_id = me::uuid;
  -- What was written cannot change, or be erased, afterwards.
  perform pg_temp.rejects('update public.training_readings set findings = ''Otra cosa'' where findings is not null',
    'A training reading''s findings are recorded once');
  perform pg_temp.rejects('update public.training_readings set findings = null, submitted_at = null, status = ''assigned'' where findings is not null',
    'A training reading''s findings are recorded once');
  -- A route is three columns or none; reading needs one.
  perform pg_temp.rejects('update public.training_readings set model = ''gpt'' where findings is not null', 'training_readings_route_check');
  perform pg_temp.rejects('update public.training_readings set status = ''comparing'' where findings is not null',
    'training_readings_route_check');
  update public.training_readings set status = 'comparing', model_provider = 'openai', model = 'gpt', credential_ref = 'user:x'
    where findings is not null;
  -- Compared: both lists, shaped and bounded; nothing of them before.
  perform pg_temp.rejects('update public.training_readings set status = ''compared'' where status = ''comparing''',
    'training_readings_result_check');
  perform pg_temp.rejects(format('update public.training_readings set machine_findings = %L where status = ''comparing''', v_machine),
    'training_readings_result_check');
  perform pg_temp.rejects(format('update public.training_readings set status = ''compared'', machine_findings = ''{"a":1}'', comparison = %L where status = ''comparing''', v_comparison),
    'training_readings_result_check');
  perform pg_temp.rejects(format('update public.training_readings set status = ''compared'', machine_findings = %L, comparison = ''[]'' where status = ''comparing''', v_machine),
    'training_readings_result_check');
  perform pg_temp.rejects(format('update public.training_readings set status = ''compared'', machine_findings = (select jsonb_agg(m.value) from jsonb_array_elements(%L::jsonb) m, generate_series(1, 9)), comparison = %L where status = ''comparing''', v_machine, v_comparison),
    'training_readings_result_check');
  update public.training_readings set status = 'compared', machine_findings = v_machine::jsonb, comparison = v_comparison::jsonb
    where status = 'comparing';
  assert (select count(*) from public.training_readings where status = 'compared') = 1, 'a compared reading is accepted';
  -- A compared reading frees the slot for the next one.
  execute format('insert into public.training_readings(org_id,trainee_user_id) values (%L,%L)', org, me);
  -- A failed comparison keeps what was written and carries no lists.
  update public.training_readings set status = 'submitted', findings = 'otra lectura', submitted_at = now()
    where status = 'assigned' and trainee_user_id = me::uuid;
  update public.training_readings set status = 'failed' where status = 'submitted' and trainee_user_id = me::uuid;
  assert (select count(*) from public.training_readings where status = 'failed') = 1, 'a failed comparison is accepted';
end;
$$;
rollback;

-- 5. The migration re-runs over the final shape, twice, and the rule holds.
begin;
\ir ../../../migrations/20261108_68_litt_training_criterion_readings.sql
\ir ../../../migrations/20261108_68_litt_training_criterion_readings.sql
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.reader_mismatches(array['pupil', 'mentor_a']);
  assert got = '', 'after re-running the migration: ' || got;
  assert exists (select 1 from pg_trigger where tgname = 'training_readings_findings_once'
    and tgrelid = 'public.training_readings'::regclass), 'the findings stay write-once';
  assert (select count(*) from pg_trigger where tgrelid = 'public.training_readings'::regclass and not tgisinternal) = 1,
    'one trigger, not two';
end;
$$;
rollback;

-- Control: without the write-once trigger the findings could be rewritten, and the checks above would catch it.
begin;
select pg_temp.fixture();
update public.training_readings set status = 'submitted', findings = 'original', submitted_at = now();
drop trigger training_readings_findings_once on public.training_readings;
update public.training_readings set findings = 'reescrito';
do $$
begin
  assert (select findings from public.training_readings) = 'reescrito',
    'control: with the trigger gone the findings can be rewritten';
end;
$$;
rollback;

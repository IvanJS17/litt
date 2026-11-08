-- LiTT training layer 2 (20261107_60_litt_training_supervision.sql): who
-- reads a pupil's learning data, and that it goes with the pupil.
--
--   1. training_can_read_learning, actor by actor: the pupil and their
--      current mentor read; a previous mentor, another mentor, the owner, an
--      admin, another pupil, a member of another firm, an unknown id and a
--      pupil who left the firm do not.
--   2. Changing the mentor changes the answer for both mentors, touching
--      nothing else; the rows stay the pupil's.
--   3. Leaving the firm and account erasure leave no learning row behind;
--      the audit events stay.
--   4. Every public.training_* table with trainee_user_id, found generically:
--      RLS on, no browser privileges, populated by this fixture and empty
--      once the pupil is gone. A future table that forgets the cascade fails.
--   5. An erased mentor's pupils are released; their reviews and defenses
--      stay, with the mentor's ids set to null.
--   6. Table constraints.
--   7. Releasing a pupil ends their passes and keeps reviews and defenses.
--   8. The migration re-runs over the final shape.
--   Then negative controls: each swaps the rule for a leaky one (or adds a
--   table that forgets the cascade) in a rolled-back transaction and asserts
--   the checks above catch it. If a control stops catching, the fixture no
--   longer exercises the rule.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingSupervision.postgres.test.ts runs it locally
-- against a disposable database and proves it fails without the rule.

create temporary table litt_training_actors(label text primary key, uid uuid not null);

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  project uuid := gen_random_uuid(); chat uuid := gen_random_uuid();
  review uuid := gen_random_uuid();
  a record;
begin
  delete from litt_training_actors;
  insert into litt_training_actors(label, uid) select l, gen_random_uuid() from unnest(array[
    'owner','admin','mentor_a','mentor_b','member','pupil','other_pupil','outsider','ghost']) l;
  for a in select * from litt_training_actors where label <> 'ghost' loop
    insert into auth.users(id, email) values (a.uid, a.uid || '@example.test');
    perform set_config('litt.' || a.label, a.uid::text, true);
  end loop;
  perform set_config('litt.ghost', (select uid::text from litt_training_actors where label = 'ghost'), true);
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', current_setting('litt.owner')::uuid),
    (other_org, 'Other synthetic firm', current_setting('litt.outsider')::uuid);
  insert into public.org_members(org_id, user_id, role)
    select org, uid, case label when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end
    from litt_training_actors where label not in ('outsider', 'ghost');
  insert into public.org_members(org_id, user_id, role)
    values (other_org, current_setting('litt.outsider')::uuid, 'owner');
  insert into public.training_mentors(org_id, user_id, designated_by) values
    (org, current_setting('litt.mentor_a')::uuid, current_setting('litt.owner')::uuid),
    (org, current_setting('litt.mentor_b')::uuid, current_setting('litt.owner')::uuid);
  insert into public.training_pupils(org_id, trainee_user_id, mentor_user_id, assigned_by) values
    (org, current_setting('litt.pupil')::uuid, current_setting('litt.mentor_a')::uuid, current_setting('litt.mentor_a')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, current_setting('litt.mentor_b')::uuid, current_setting('litt.mentor_b')::uuid);
  insert into public.training_stages(org_id, trainee_user_id, practice, stage, updated_by)
    values (org, current_setting('litt.pupil')::uuid, null, 'pasante', current_setting('litt.mentor_a')::uuid);
  insert into public.projects(id, user_id, org_id, name, visibility)
    values (project, current_setting('litt.owner')::uuid, org, 'Synthetic matter', 'organization');
  insert into public.chats(id, user_id, org_id, project_id)
    values (chat, current_setting('litt.pupil')::uuid, org, project);
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt)
    values (org, current_setting('litt.pupil')::uuid, chat, gen_random_uuid(), repeat('x', 60));
  insert into public.training_backing_checks(org_id, trainee_user_id, chat_id, message_id, status, conclusions)
    values (org, current_setting('litt.pupil')::uuid, chat, gen_random_uuid(), 'ready',
      '[{"id":"c1","text":"t","citation_ref":null,"status":"unbacked"}]');
  insert into public.training_work_reviews(id, org_id, trainee_user_id, chat_id, status,
      proposed, ai_corrected, doubts, unverified, model_provider, model, credential_ref,
      generated_by, generated_at, reviewed_at, reviewed_by)
    values (review, org, current_setting('litt.pupil')::uuid, chat, 'ready',
      '[{"source":"attempt","text":"t"}]', '[]', '[]', '[]', 'openai', 'gpt', 'user:x',
      current_setting('litt.mentor_a')::uuid, now(), now(), current_setting('litt.mentor_a')::uuid);
  insert into public.training_defenses(org_id, trainee_user_id, practice, work_review_id,
      questions, questions_status, model_provider, model, credential_ref, generated_by,
      outcome, outcome_reason, outcome_note, held_at, recorded_by)
    values (org, current_setting('litt.pupil')::uuid, 'laboral', review,
      pg_temp.questions(4, 1), 'ready', 'openai', 'gpt', 'user:x', current_setting('litt.mentor_a')::uuid,
      'approved', 'razonamiento_solido', 'nota', now(), current_setting('litt.mentor_a')::uuid);
  insert into public.training_urgency_passes(org_id, trainee_user_id, project_id, granted_by,
      expires_at, reason_code, reason_note)
    values (org, current_setting('litt.pupil')::uuid, project, current_setting('litt.mentor_a')::uuid,
      now() + interval '8 hours', 'plazo', 'nota libre');
  insert into public.training_readings(org_id, trainee_user_id, project_id, status)
    values (org, current_setting('litt.pupil')::uuid, project, 'assigned');
  -- Training audit events name the pupil only as target_user_id.
  insert into public.audit_events(user_id, action, surface, detail)
    values (current_setting('litt.owner')::uuid, 'training.urgency_pass_granted', 'organization',
      jsonb_build_object('org_id', org, 'target_user_id', current_setting('litt.pupil')));
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.other_org', other_org::text, true);
  perform set_config('litt.review', review::text, true);
  perform set_config('litt.project', project::text, true);
  perform set_config('litt.chat', chat::text, true);
end;
$$;

-- n base questions and m changes of facts, each with text and listen_for.
create function pg_temp.questions(n int, m int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(q), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'base', 'text', 'q', 'listen_for', 'l') q from generate_series(1, n)
    union all
    select jsonb_build_object('kind', 'cambio_de_hechos', 'text', 'q', 'listen_for', 'l') from generate_series(1, m)
  ) s;
$$;

-- Who reads p_trainee's learning data in the firm, against who should
-- (p_readers). Empty when they agree.
create function pg_temp.reader_mismatches(p_trainee text, p_readers text[]) returns text language plpgsql as $$
declare result text;
begin
  select string_agg(format('%s %s %s', a.label,
    case when x.got then 'reads' else 'does not read' end, p_trainee), '; ' order by a.label) into result
  from litt_training_actors a
  cross join lateral (select public.training_can_read_learning(
    a.uid, current_setting('litt.org')::uuid, current_setting('litt.' || p_trainee)::uuid) got) x
  where x.got is distinct from (a.label = any(p_readers));
  return coalesce(result, '');
end;
$$;

-- Every public.training_* table with trainee_user_id: RLS on, no browser
-- privilege, and (p_expect) rows of the pupil present or gone. Empty when
-- they all hold.
create function pg_temp.learning_table_issues(p_pupil uuid, p_expect text) returns text language plpgsql as $$
declare t record; n bigint; issues text[] := '{}';
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.table_name like 'training\_%' and c.column_name = 'trainee_user_id'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t.table_name)::regclass) then
      issues := issues || format('%s: RLS off', t.table_name);
    end if;
    if exists (select 1 from unnest(array['anon', 'authenticated']) r,
        unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(r, format('public.%I', t.table_name), p)) then
      issues := issues || format('%s: a browser role has a privilege', t.table_name);
    end if;
    execute format('select count(*) from public.%I where trainee_user_id = $1', t.table_name) into n using p_pupil;
    if p_expect = 'present' and n = 0 then
      issues := issues || format('%s: the fixture has no row of the pupil (add one)', t.table_name);
    elsif p_expect = 'gone' and n > 0 then
      issues := issues || format('%s: %s row(s) of the pupil remain', t.table_name, n);
    end if;
  end loop;
  return array_to_string(issues, '; ');
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

-- 1. The matrix, and the function is closed to the browser roles.
begin;
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_a']);
  assert got = '', 'matrix: ' || got;
  got := pg_temp.reader_mismatches('other_pupil', array['other_pupil', 'mentor_b']);
  assert got = '', 'matrix: ' || got;
  assert not public.training_can_read_learning(current_setting('litt.pupil')::uuid,
    current_setting('litt.other_org')::uuid, current_setting('litt.pupil')::uuid),
    'matrix: the pupil is not a member of the other firm';
  assert not public.training_can_read_learning(current_setting('litt.mentor_a')::uuid,
    current_setting('litt.other_org')::uuid, current_setting('litt.pupil')::uuid),
    'matrix: the mentor relation is per firm';
  assert not public.training_can_read_learning(null, current_setting('litt.org')::uuid,
    current_setting('litt.pupil')::uuid), 'matrix: a null actor reads nothing';
  assert not public.training_can_read_learning(current_setting('litt.pupil')::uuid,
    current_setting('litt.org')::uuid, null), 'matrix: a null trainee is nobody';
  assert not has_function_privilege('authenticated', 'public.training_can_read_learning(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.training_can_read_learning(uuid,uuid,uuid)', 'execute'),
    'the rule is not callable by the browser roles';
  assert has_function_privilege('service_role', 'public.training_can_read_learning(uuid,uuid,uuid)', 'execute'),
    'the backend calls the rule';
  -- 4. Generic discovery: the fixture populates every learning table.
  got := pg_temp.learning_table_issues(current_setting('litt.pupil')::uuid, 'present');
  assert got = '', 'learning tables: ' || got;
  assert (select count(*) from information_schema.columns where table_schema = 'public'
    and column_name = 'trainee_user_id'
    and table_name in ('training_work_reviews', 'training_defenses', 'training_urgency_passes')) = 3,
    'discovery finds the layer-2 tables';
end;
$$;
rollback;

-- 2. Changing the mentor.
begin;
select pg_temp.fixture();
do $$
declare got text; before_rows bigint; after_rows bigint;
begin
  select (select count(*) from public.training_work_reviews) + (select count(*) from public.training_defenses)
    + (select count(*) from public.training_urgency_passes) into before_rows;
  update public.training_pupils set mentor_user_id = current_setting('litt.mentor_b')::uuid
    where trainee_user_id = current_setting('litt.pupil')::uuid;
  got := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_b']);
  assert got = '', 'after reassigning: ' || got;
  select (select count(*) from public.training_work_reviews) + (select count(*) from public.training_defenses)
    + (select count(*) from public.training_urgency_passes) into after_rows;
  assert after_rows = before_rows, 'reassigning touches no learning row';
  assert (select count(*) from public.training_work_reviews where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'the review is still the pupil''s';
  assert (select count(*) from public.training_defenses where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'the defense is still the pupil''s';
end;
$$;
rollback;

-- 3a. Leaving the firm.
begin;
select pg_temp.fixture();
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
declare got text;
begin
  got := pg_temp.learning_table_issues(current_setting('litt.pupil')::uuid, 'gone');
  assert got = '', 'after leaving: ' || got;
  got := pg_temp.reader_mismatches('pupil', array[]::text[]);
  assert got = '', 'after leaving nobody reads, not even the former pupil: ' || got;
  assert (select count(*) from public.audit_events
    where detail->>'target_user_id' = current_setting('litt.pupil')) = 1, 'the audit event stays';
  assert (select count(*) from public.chats where id = current_setting('litt.chat')::uuid) = 1,
    'the matter chat stays with the firm';
end;
$$;
rollback;

-- 3b. Account erasure: departures first, then the account row.
begin;
select pg_temp.fixture();
select public.prepare_account_org_departures(current_setting('litt.pupil')::uuid);
delete from auth.users where id = current_setting('litt.pupil')::uuid;
do $$
declare got text;
begin
  got := pg_temp.learning_table_issues(current_setting('litt.pupil')::uuid, 'gone');
  assert got = '', 'after erasure: ' || got;
  assert (select count(*) from public.audit_events
    where detail->>'target_user_id' = current_setting('litt.pupil')) = 1, 'the audit event stays';
end;
$$;
rollback;

-- 5. An erased mentor: pupils released, their reviews and defenses stay.
begin;
select pg_temp.fixture();
select public.prepare_account_org_departures(current_setting('litt.mentor_a')::uuid);
delete from auth.users where id = current_setting('litt.mentor_a')::uuid;
do $$
begin
  assert (select count(*) from public.training_pupils where trainee_user_id = current_setting('litt.pupil')::uuid) = 0,
    'erased mentor: the pupil is released';
  assert (select count(*) from public.training_urgency_passes) = 0, 'erased mentor: the pass ends';
  assert (select count(*) from public.training_work_reviews where trainee_user_id = current_setting('litt.pupil')::uuid
    and generated_by is null and reviewed_by is null) = 1, 'erased mentor: the review stays, without the mentor''s id';
  assert (select count(*) from public.training_defenses where trainee_user_id = current_setting('litt.pupil')::uuid
    and generated_by is null and recorded_by is null and outcome = 'approved') = 1,
    'erased mentor: the defense and its outcome stay, without the mentor''s id';
  assert public.training_can_read_learning(current_setting('litt.pupil')::uuid,
    current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid), 'the pupil still reads their own';
  assert (select count(*) from public.training_pupils where trainee_user_id = current_setting('litt.other_pupil')::uuid) = 1,
    'another mentor''s pupil is untouched';
end;
$$;
rollback;

-- 6. Constraints.
begin;
select pg_temp.fixture();
do $$
declare
  ins_review text := format('insert into public.training_work_reviews(org_id,trainee_user_id,%%s) values (%L,%L,%%s)',
    current_setting('litt.org'), current_setting('litt.pupil'));
  ins_defense text := format('insert into public.training_defenses(org_id,trainee_user_id,%%s) values (%L,%L,%%s)',
    current_setting('litt.org'), current_setting('litt.pupil'));
  ins_pass text := format('insert into public.training_urgency_passes(org_id,trainee_user_id,project_id,%%s) values (%L,%L,%L,%%s)',
    current_setting('litt.org'), current_setting('litt.pupil'), current_setting('litt.project'));
  route text := '''openai'',''gpt'',''user:x''';
begin
  -- One chat per review, one review per chat.
  perform pg_temp.rejects(format(ins_review, 'status', '''pending'''), 'training_work_reviews_one_chat');
  perform pg_temp.rejects(format(ins_review, 'chat_id', quote_literal(current_setting('litt.chat'))),
    'training_work_reviews_chat_key');
  perform pg_temp.rejects('update public.training_work_reviews set status=''listo''', 'training_work_reviews_status_check');
  perform pg_temp.rejects('update public.training_work_reviews set doubts=null', 'training_work_reviews_ready_check');
  perform pg_temp.rejects('update public.training_work_reviews set doubts=''{"a":1}''', 'training_work_reviews_content_check');
  perform pg_temp.rejects('update public.training_work_reviews set credential_ref=null', 'training_work_reviews_route_check');
  perform pg_temp.rejects('update public.training_work_reviews set reviewed_at=null', 'training_work_reviews_reviewed_check');
  -- Ready questions: five, exactly one change of facts, each complete.
  perform pg_temp.rejects(format(ins_defense, 'questions,questions_status,model_provider,model,credential_ref',
    quote_literal(pg_temp.questions(3, 1)) || ',''ready'',' || route), 'training_defenses_questions_check');
  perform pg_temp.rejects(format(ins_defense, 'questions,questions_status,model_provider,model,credential_ref',
    quote_literal(pg_temp.questions(3, 2)) || ',''ready'',' || route), 'training_defenses_questions_check');
  perform pg_temp.rejects(format(ins_defense, 'questions,questions_status,model_provider,model,credential_ref',
    quote_literal(pg_temp.questions(5, 0)) || ',''ready'',' || route), 'training_defenses_questions_check');
  perform pg_temp.rejects(format(ins_defense, 'questions,questions_status,model_provider,model,credential_ref',
    quote_literal(jsonb_set(pg_temp.questions(4, 1), '{0}', '{"kind":"base","text":"q"}')) || ',''ready'',' || route),
    'training_defenses_questions_check');
  perform pg_temp.rejects(format(ins_defense, 'questions,questions_status,model_provider,model,credential_ref',
    '''{"kind":"base"}'',''ready'',' || route), 'training_defenses_questions_check');
  perform pg_temp.rejects(format(ins_defense, 'questions_status', '''ready'''), 'training_defenses_questions_check');
  perform pg_temp.rejects(format(ins_defense, 'questions_status', '''lista'''), 'training_defenses_questions_status_check');
  perform pg_temp.rejects(format(ins_defense, 'practice', '''Laboral'''), 'training_defenses_practice_check');
  -- Outcome: with held_at, recorded once; recording without questions is fine.
  perform pg_temp.rejects(format(ins_defense, 'outcome', '''approved'''), 'training_defenses_outcome_check');
  perform pg_temp.rejects(format(ins_defense, 'outcome,held_at', '''aprobada'',now()'), 'training_defenses_outcome_check');
  perform pg_temp.rejects(format(ins_defense, 'outcome_note', '''nota'''), 'training_defenses_outcome_check');
  perform pg_temp.rejects(format(ins_defense, 'recorded_by', quote_literal(current_setting('litt.mentor_a'))),
    'training_defenses_outcome_check');
  -- The reason is part of the outcome: required with it, from a closed list;
  -- the note takes up to 500 characters (20261107_90).
  perform pg_temp.rejects(format(ins_defense, 'outcome,held_at', '''approved'',now()'), 'training_defenses_outcome_check');
  perform pg_temp.rejects(format(ins_defense, 'outcome_reason', '''otro'''), 'training_defenses_outcome_check');
  perform pg_temp.rejects(format(ins_defense, 'outcome,outcome_reason,held_at', '''approved'',''excelente'',now()'),
    'training_defenses_outcome_check');
  perform pg_temp.rejects(format(ins_defense, 'outcome,outcome_reason,outcome_note,held_at',
    '''approved'',''otro'',' || quote_literal(repeat('x', 501)) || ',now()'), 'training_defenses_outcome_check');
  execute format(ins_defense, 'outcome,outcome_reason,outcome_note,held_at',
    '''approved'',''otro'',' || quote_literal(repeat('x', 500)) || ',now()');
  execute format(ins_defense, 'outcome,outcome_reason,held_at,recorded_by', '''not_approved'',''sin_sustento'',now(),' || quote_literal(current_setting('litt.mentor_a')));
  perform pg_temp.rejects('update public.training_defenses set outcome=''not_approved'' where outcome=''approved''',
    'A training defense outcome is recorded once');
  perform pg_temp.rejects('update public.training_defenses set outcome_note=''otra'' where outcome=''approved''',
    'A training defense outcome is recorded once');
  perform pg_temp.rejects('update public.training_defenses set outcome_reason=''otro'' where outcome=''not_approved''',
    'A training defense outcome is recorded once');
  perform pg_temp.rejects(format('update public.training_defenses set recorded_by=%L where outcome=''approved''',
    current_setting('litt.mentor_b')), 'A training defense outcome is recorded once');
  -- A defense points only at a review of the same pupil.
  perform pg_temp.rejects(format('insert into public.training_defenses(org_id,trainee_user_id,work_review_id) values (%L,%L,%L)',
    current_setting('litt.org'), current_setting('litt.other_pupil'), current_setting('litt.review')),
    'training_defenses_work_review_fkey');
  -- Passes: a window, a closed reason list, a short note, a pupil with a mentor.
  perform pg_temp.rejects(format(ins_pass, 'starts_at,expires_at,reason_code', 'now(),now(),''plazo'''),
    'training_urgency_passes_window_check');
  perform pg_temp.rejects(format(ins_pass, 'expires_at,reason_code', 'now()+interval ''1 hour'',''capricho'''),
    'training_urgency_passes_reason_check');
  perform pg_temp.rejects(format(ins_pass, 'expires_at,reason_code,reason_note',
    'now()+interval ''1 hour'',''otro'',' || quote_literal(repeat('x', 501))), 'training_urgency_passes_reason_check');
  perform pg_temp.rejects(format(ins_pass, 'expires_at,reason_code,revoked_by',
    'now()+interval ''1 hour'',''otro'',' || quote_literal(current_setting('litt.mentor_a'))), 'training_urgency_passes_revoked_check');
  perform pg_temp.rejects(format('insert into public.training_urgency_passes(org_id,trainee_user_id,project_id,expires_at,reason_code)
    values (%L,%L,%L,now()+interval ''1 hour'',''plazo'')', current_setting('litt.org'), current_setting('litt.member'),
    current_setting('litt.project')), 'training_urgency_passes_pupil_fkey');
  perform pg_temp.rejects(format('insert into public.training_defenses(org_id,trainee_user_id) values (%L,%L)',
    current_setting('litt.org'), current_setting('litt.outsider')), 'training_defenses_member_fkey');
  -- Deleting the review keeps the defense, unlinked.
  delete from public.training_work_reviews;
  assert (select count(*) from public.training_defenses where outcome = 'approved' and outcome_note = 'nota'
      and work_review_id is null) = 1,
    'the defense outlives the review it was about';
end;
$$;
rollback;

-- 7. Releasing the pupil.
begin;
select pg_temp.fixture();
delete from public.training_pupils where trainee_user_id = current_setting('litt.pupil')::uuid;
do $$
declare got text;
begin
  assert (select count(*) from public.training_urgency_passes) = 0, 'released: the pass ends';
  assert (select count(*) from public.training_work_reviews) = 1, 'released: the review stays';
  assert (select count(*) from public.training_defenses) = 1, 'released: the defense stays';
  assert (select count(*) from public.training_turn_notes) = 1, 'released: the turn note stays';
  got := pg_temp.reader_mismatches('pupil', array['pupil']);
  assert got = '', 'released: only the pupil reads: ' || got;
end;
$$;
rollback;

-- 8. The migration re-runs over the final shape, twice, and the rule holds.
begin;
\ir ../../../migrations/20261107_60_litt_training_supervision.sql
\ir ../../../migrations/20261107_60_litt_training_supervision.sql
-- The later migration that reshapes the defense outcome, as the runner would.
\ir ../../../migrations/20261107_90_litt_training_defense_outcome.sql
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_a']);
  assert got = '', 'after re-running the migration: ' || got;
end;
$$;
rollback;

-- Control 1: a rule that lets owners and admins read must fail the matrix.
begin;
select pg_temp.fixture();
create or replace function public.training_can_read_learning(p_actor uuid, p_org uuid, p_trainee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor = p_trainee
    or exists (select 1 from public.training_pupils p where p.org_id = p_org
      and p.trainee_user_id = p_trainee and p.mentor_user_id = p_actor)
    or exists (select 1 from public.org_members m where m.org_id = p_org
      and m.user_id = p_actor and m.role in ('owner', 'admin'));
$$;
do $$
declare got text := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_a']);
begin
  assert got like '%admin reads pupil%' and got like '%owner reads pupil%',
    'control 1: the matrix must catch owners and admins reading (got: ' || got || ')';
end;
$$;
rollback;

-- Control 2: a rule that lets any mentor of the firm read must fail after
-- reassigning (the previous mentor keeps reading).
begin;
select pg_temp.fixture();
create or replace function public.training_can_read_learning(p_actor uuid, p_org uuid, p_trainee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor = p_trainee
    or exists (select 1 from public.training_mentors m where m.org_id = p_org and m.user_id = p_actor);
$$;
update public.training_pupils set mentor_user_id = current_setting('litt.mentor_b')::uuid
  where trainee_user_id = current_setting('litt.pupil')::uuid;
do $$
declare got text := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_b']);
begin
  assert got like '%mentor_a reads pupil%',
    'control 2: the matrix must catch the previous mentor reading (got: ' || got || ')';
end;
$$;
rollback;

-- Control 3: a rule that forgets membership must fail once the pupil left.
begin;
select pg_temp.fixture();
create or replace function public.training_can_read_learning(p_actor uuid, p_org uuid, p_trainee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_actor = p_trainee, false);
$$;
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
declare got text := pg_temp.reader_mismatches('pupil', array[]::text[]);
begin
  assert got like '%pupil reads pupil%',
    'control 3: the matrix must catch a former member reading (got: ' || got || ')';
end;
$$;
rollback;

-- Control 4: a new learning table that forgets the membership cascade must
-- fail the generic discovery.
begin;
select pg_temp.fixture();
create table public.training_zz_forgotten(org_id uuid not null, trainee_user_id uuid not null);
alter table public.training_zz_forgotten enable row level security;
revoke all on public.training_zz_forgotten from anon, authenticated;
insert into public.training_zz_forgotten values (current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid);
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
declare got text := pg_temp.learning_table_issues(current_setting('litt.pupil')::uuid, 'gone');
begin
  assert got = 'training_zz_forgotten: 1 row(s) of the pupil remain',
    'control 4: discovery must catch a table without the cascade (got: ' || got || ')';
end;
$$;
rollback;

-- Control 5: a new learning table readable by the browser must fail too.
begin;
select pg_temp.fixture();
create table public.training_zz_open(org_id uuid not null, trainee_user_id uuid not null);
grant select on public.training_zz_open to authenticated;
do $$
declare got text := pg_temp.learning_table_issues(current_setting('litt.pupil')::uuid, 'present');
begin
  assert got like '%training_zz_open: RLS off%' and got like '%training_zz_open: a browser role has a privilege%'
    and got like '%training_zz_open: the fixture has no row of the pupil%',
    'control 5: discovery must catch an open table (got: ' || got || ')';
end;
$$;
rollback;

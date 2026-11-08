-- LiTT training layer 3, card 2 (20261108_60_litt_training_criterion_turns.sql):
-- the columns the turn notes gained (thermometer mark, verdict, basis,
-- topics, answer_unverified, mode and step) are learning data like the rest
-- of the note.
--
--   1. Every public.training_* table with trainee_user_id still has RLS on and
--      no browser privilege; the note carrying the new columns is no exception.
--   2. training_can_read_learning, actor by actor, for the pupil whose note
--      carries a verdict: the pupil and their CURRENT mentor; never the owner
--      or an admin, a previous mentor, another pupil, an outsider, a ghost.
--   3. Changing the mentor changes who reads and touches no note column.
--   4. Leaving the firm and account erasure leave no note behind, columns
--      included; the audit event stays. An erased mentor leaves the pupil's
--      notes with their verdict and without the mentor's id.
--   5. The constraints of the new columns, and that the notes of layers 1 and
--      2 (all of them null) still insert.
--   6. The migration re-runs over its own final shape.
--   Then negative controls: a rule that lets owners read, and a learning table
--   that forgets the membership cascade, both caught.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingCriterion.postgres.test.ts runs it locally
-- against a disposable database and proves it fails without the rules.

create temporary table litt_criterion_actors(label text primary key, uid uuid not null);

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  chat uuid := gen_random_uuid(); other_chat uuid := gen_random_uuid();
  a record;
begin
  delete from litt_criterion_actors;
  insert into litt_criterion_actors(label, uid) select l, gen_random_uuid() from unnest(array[
    'owner','admin','mentor_a','mentor_b','member','pupil','other_pupil','outsider','ghost']) l;
  for a in select * from litt_criterion_actors where label <> 'ghost' loop
    insert into auth.users(id, email) values (a.uid, a.uid || '@example.test');
    perform set_config('litt.' || a.label, a.uid::text, true);
  end loop;
  perform set_config('litt.ghost', (select uid::text from litt_criterion_actors where label = 'ghost'), true);
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', current_setting('litt.owner')::uuid),
    (other_org, 'Other synthetic firm', current_setting('litt.outsider')::uuid);
  insert into public.org_members(org_id, user_id, role)
    select org, uid, case label when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end
    from litt_criterion_actors where label not in ('outsider', 'ghost');
  insert into public.org_members(org_id, user_id, role)
    values (other_org, current_setting('litt.outsider')::uuid, 'owner');
  insert into public.training_mentors(org_id, user_id, designated_by) values
    (org, current_setting('litt.mentor_a')::uuid, current_setting('litt.owner')::uuid),
    (org, current_setting('litt.mentor_b')::uuid, current_setting('litt.owner')::uuid);
  insert into public.training_pupils(org_id, trainee_user_id, mentor_user_id, assigned_by) values
    (org, current_setting('litt.pupil')::uuid, current_setting('litt.mentor_a')::uuid, current_setting('litt.mentor_a')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, current_setting('litt.mentor_b')::uuid, current_setting('litt.mentor_b')::uuid);
  insert into public.chats(id, user_id, org_id) values
    (chat, current_setting('litt.pupil')::uuid, org),
    (other_chat, current_setting('litt.other_pupil')::uuid, org);
  -- A judged note: every new column filled, the verdict corrected by the mentor.
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt,
      contrast, contrast_status, confidence, verdict, verdict_source, verdict_by, foundation,
      foundation_question, topics, answer_unverified, mode, step)
    values (org, current_setting('litt.pupil')::uuid, chat, gen_random_uuid(), repeat('x', 60),
      'Coincide', 'ready', 4, 'coincide', 'mentor', current_setting('litt.mentor_a')::uuid, 'weak',
      '¿En qué se apoya?', array['rescisión', 'prescripción'], true, 'counterpart', 2);
  -- A hint: nothing to contrast.
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt,
      contrast_status, confidence, mode, step)
    values (org, current_setting('litt.pupil')::uuid, chat, gen_random_uuid(), repeat('x', 60),
      'skipped', 2, 'hint', 1);
  -- A note of layers 1 and 2: every new column null.
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt)
    values (org, current_setting('litt.pupil')::uuid, chat, gen_random_uuid(), repeat('x', 60));
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt, confidence)
    values (org, current_setting('litt.other_pupil')::uuid, other_chat, gen_random_uuid(), repeat('y', 60), 1);
  -- Training audit events name the pupil only as target_user_id.
  insert into public.audit_events(user_id, action, surface, chat_id, detail)
    values (current_setting('litt.mentor_a')::uuid, 'training.verdict_overridden', 'organization', chat,
      jsonb_build_object('org_id', org, 'target_user_id', current_setting('litt.pupil')));
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.other_org', other_org::text, true);
  perform set_config('litt.chat', chat::text, true);
end;
$$;

-- Who reads p_trainee's learning data in the firm, against who should
-- (p_readers). Empty when they agree.
create function pg_temp.reader_mismatches(p_trainee text, p_readers text[]) returns text language plpgsql as $$
declare result text;
begin
  select string_agg(format('%s %s %s', a.label,
    case when x.got then 'reads' else 'does not read' end, p_trainee), '; ' order by a.label) into result
  from litt_criterion_actors a
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
    if p_expect = 'gone' and n > 0 then
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

-- 1 and 2. The generic tables, and the matrix for a pupil whose note carries a verdict.
begin;
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.learning_table_issues(current_setting('litt.pupil')::uuid, 'present');
  assert got = '', 'learning tables: ' || got;
  assert exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'training_turn_notes' and column_name = 'trainee_user_id'),
    'discovery finds the notes table';
  assert (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'training_turn_notes' and column_name in ('confidence','verdict','verdict_source','verdict_by',
      'foundation','foundation_question','topics','answer_unverified','mode','step')) = 10,
    'the notes table has the ten layer-3 columns';
  got := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_a']);
  assert got = '', 'matrix: ' || got;
  got := pg_temp.reader_mismatches('other_pupil', array['other_pupil', 'mentor_b']);
  assert got = '', 'matrix: ' || got;
  assert not public.training_can_read_learning(current_setting('litt.mentor_a')::uuid,
    current_setting('litt.other_org')::uuid, current_setting('litt.pupil')::uuid),
    'matrix: the mentor relation is per firm';
  -- The helper of the topics check is closed to the browser roles.
  assert not has_function_privilege('authenticated', 'public.training_topics_valid(text[])', 'execute')
    and not has_function_privilege('anon', 'public.training_topics_valid(text[])', 'execute'),
    'training_topics_valid is not callable by the browser roles';
  assert has_function_privilege('service_role', 'public.training_topics_valid(text[])', 'execute'),
    'the backend can write notes';
end;
$$;
rollback;

-- 3. Changing the mentor.
begin;
select pg_temp.fixture();
do $$
declare got text; before_notes text; after_notes text;
begin
  select string_agg(n::text, '|' order by n.id) into before_notes from public.training_turn_notes n;
  update public.training_pupils set mentor_user_id = current_setting('litt.mentor_b')::uuid
    where trainee_user_id = current_setting('litt.pupil')::uuid;
  got := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_b']);
  assert got = '', 'after reassigning: ' || got;
  select string_agg(n::text, '|' order by n.id) into after_notes from public.training_turn_notes n;
  assert after_notes = before_notes, 'reassigning touches no note, no column';
  assert (select count(*) from public.training_turn_notes
    where trainee_user_id = current_setting('litt.pupil')::uuid) = 3, 'the notes are still the pupil''s';
  assert (select verdict_by from public.training_turn_notes where verdict = 'coincide')
    = current_setting('litt.mentor_a')::uuid, 'the correction still names the mentor who made it';
end;
$$;
rollback;

-- 4a. Leaving the firm.
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
  assert (select count(*) from public.training_turn_notes where trainee_user_id = current_setting('litt.other_pupil')::uuid) = 1,
    'another pupil''s note is untouched';
  assert (select count(*) from public.audit_events
    where detail->>'target_user_id' = current_setting('litt.pupil')) = 1, 'the audit event stays';
  assert (select count(*) from public.chats where id = current_setting('litt.chat')::uuid) = 1,
    'the chat stays with the firm';
end;
$$;
rollback;

-- 4b. Account erasure: departures first, then the account row.
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

-- 4c. An erased mentor: the pupil is released, their notes keep the verdict
-- the mentor gave, without the mentor's id.
begin;
select pg_temp.fixture();
select public.prepare_account_org_departures(current_setting('litt.mentor_a')::uuid);
delete from auth.users where id = current_setting('litt.mentor_a')::uuid;
do $$
begin
  assert (select count(*) from public.training_turn_notes where trainee_user_id = current_setting('litt.pupil')::uuid) = 3,
    'erased mentor: the pupil''s notes stay';
  assert (select count(*) from public.training_turn_notes where trainee_user_id = current_setting('litt.pupil')::uuid
    and verdict = 'coincide' and verdict_source = 'mentor' and verdict_by is null) = 1,
    'erased mentor: the corrected verdict stays, without the mentor''s id';
  assert public.training_can_read_learning(current_setting('litt.pupil')::uuid,
    current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid), 'the pupil still reads their own';
end;
$$;
rollback;

-- 5. Constraints.
begin;
select pg_temp.fixture();
do $$
declare
  ins text := format('insert into public.training_turn_notes(org_id,trainee_user_id,chat_id,message_id,attempt,%%s) values (%L,%L,%L,gen_random_uuid(),repeat(''x'',60),%%s)',
    current_setting('litt.org'), current_setting('litt.pupil'), current_setting('litt.chat'));
  upd text := 'update public.training_turn_notes set %s where verdict = ''coincide''';
begin
  -- The thermometer: 1 to 4.
  perform pg_temp.rejects(format(ins, 'confidence', '0'), 'training_turn_notes_confidence_check');
  perform pg_temp.rejects(format(ins, 'confidence', '5'), 'training_turn_notes_confidence_check');
  execute format(ins, 'confidence', '1');
  execute format(ins, 'confidence', '4');
  -- The verdict: one of three, with its source; the mentor's id only with the mentor's source.
  perform pg_temp.rejects(format(ins, 'verdict,verdict_source', '''casi'',''contrast'''), 'training_turn_notes_verdict_check');
  perform pg_temp.rejects(format(ins, 'verdict', '''coincide'''), 'training_turn_notes_verdict_check');
  perform pg_temp.rejects(format(ins, 'verdict_source', '''contrast'''), 'training_turn_notes_verdict_check');
  perform pg_temp.rejects(format(ins, 'verdict,verdict_source', '''parcial'',''ia'''), 'training_turn_notes_verdict_check');
  perform pg_temp.rejects(format(ins, 'verdict,verdict_source,verdict_by', '''parcial'',''contrast'',' || quote_literal(current_setting('litt.mentor_a'))),
    'training_turn_notes_verdict_check');
  execute format(ins, 'verdict,verdict_source', '''no_coincide'',''contrast''');
  execute format(ins, 'verdict,verdict_source,verdict_by', '''parcial'',''mentor'',' || quote_literal(current_setting('litt.mentor_a')));
  -- The basis, and the one question that goes with a weak or wrong one.
  perform pg_temp.rejects(format(ins, 'foundation', '''firme'''), 'training_turn_notes_foundation_check');
  perform pg_temp.rejects(format(ins, 'foundation_question', '''¿Por qué?'''), 'training_turn_notes_foundation_check');
  perform pg_temp.rejects(format(ins, 'foundation,foundation_question', '''solid'',''¿Por qué?'''), 'training_turn_notes_foundation_check');
  perform pg_temp.rejects(format(ins, 'foundation,foundation_question', '''weak'',''''' ), 'training_turn_notes_foundation_check');
  perform pg_temp.rejects(format(ins, 'foundation,foundation_question', '''wrong'',' || quote_literal(repeat('x', 501))),
    'training_turn_notes_foundation_check');
  execute format(ins, 'foundation,foundation_question', '''wrong'',' || quote_literal(repeat('x', 500)));
  execute format(ins, 'foundation', '''solid''');
  -- Topics: one to three labels of 1 to 80 characters.
  perform pg_temp.rejects(format(ins, 'topics', '''{}''::text[]'), 'training_turn_notes_topics_check');
  perform pg_temp.rejects(format(ins, 'topics', '''{a,b,c,d}''::text[]'), 'training_turn_notes_topics_check');
  perform pg_temp.rejects(format(ins, 'topics', 'array[' || quote_literal(repeat('x', 81)) || ']'), 'training_turn_notes_topics_check');
  perform pg_temp.rejects(format(ins, 'topics', 'array[''a'', null]'), 'training_turn_notes_topics_check');
  perform pg_temp.rejects(format(ins, 'topics', '''{" "}''::text[]'), 'training_turn_notes_topics_check');
  execute format(ins, 'topics', 'array[' || quote_literal(repeat('x', 80)) || ', ''b'', ''c'']');
  -- Mode and step: together, and in range.
  perform pg_temp.rejects(format(ins, 'mode,step', '''pista'',1'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'mode', '''hint'''), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'step', '1'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'mode,step', '''hint'',0'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'mode,step', '''counterpart'',4'), 'training_turn_notes_mode_check');
  execute format(ins, 'mode,step', '''counterpart_close'',3');
  -- The contrast status admits skipped, and still ties ready to a contrast.
  perform pg_temp.rejects(format(ins, 'contrast_status', '''omitido'''), 'training_turn_notes_status_check');
  perform pg_temp.rejects(format(ins, 'contrast_status,contrast', '''skipped'',''Coincide'''), 'training_turn_notes_contrast_check');
  perform pg_temp.rejects(format(ins, 'contrast_status', '''ready'''), 'training_turn_notes_contrast_check');
  execute format(ins, 'contrast_status', '''skipped''');
  -- answer_unverified is never null.
  perform pg_temp.rejects(format(ins, 'answer_unverified', 'null'), 'answer_unverified');
  perform pg_temp.rejects(format(upd, 'confidence = 9'), 'training_turn_notes_confidence_check');
  -- A note of layers 1 and 2 still inserts: nothing new is required.
  execute format('insert into public.training_turn_notes(org_id,trainee_user_id,chat_id,message_id,attempt) values (%L,%L,%L,%L,repeat(''x'',60))',
    current_setting('litt.org'), current_setting('litt.pupil'), current_setting('litt.chat'), '00000000-0000-4000-8000-0000000000aa');
  assert (select answer_unverified is false and confidence is null and verdict is null and mode is null
    from public.training_turn_notes where message_id = '00000000-0000-4000-8000-0000000000aa'),
    'a note of layers 1 and 2 keeps every new column null, answer_unverified false';
end;
$$;
rollback;

-- 6. The migration re-runs over the final shape, and the notes keep reading the same.
begin;
\ir ../../../migrations/20261108_60_litt_training_criterion_turns.sql
\ir ../../../migrations/20261108_60_litt_training_criterion_turns.sql
select pg_temp.fixture();
do $$
declare got text;
begin
  got := pg_temp.reader_mismatches('pupil', array['pupil', 'mentor_a']);
  assert got = '', 'after re-running the migration: ' || got;
  assert (select count(*) from public.training_turn_notes where trainee_user_id = current_setting('litt.pupil')::uuid) = 3,
    'the fixture still inserts after re-running the migration';
  perform pg_temp.rejects(format('update public.training_turn_notes set confidence = 7 where id = %L',
    (select id from public.training_turn_notes limit 1)), 'training_turn_notes_confidence_check');
  assert (select count(*) from pg_constraint where conrelid = 'public.training_turn_notes'::regclass
    and conname in ('training_turn_notes_confidence_check','training_turn_notes_verdict_check',
      'training_turn_notes_foundation_check','training_turn_notes_topics_check','training_turn_notes_mode_check',
      'training_turn_notes_status_check')) = 6, 'each check exists once after the re-run';
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

-- Control 2: a new learning table that forgets the membership cascade must
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
    'control 2: discovery must catch a table without the cascade (got: ' || got || ')';
end;
$$;
rollback;

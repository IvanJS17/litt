-- LiTT training layer 3 card 8 (20261108_64_litt_training_criterion_backing.sql):
-- the accountability checks of a junior's answers are learning data.
--
--   1. Who can reach a pupil's checks: the rule is training_can_read_learning
--      (the backend asks it before every read); the pupil and the CURRENT
--      mentor yes; an owner, an admin, a previous mentor, another member and
--      a member of another firm no. The table itself has RLS on and no
--      privilege for the browser roles.
--   2. Changing the mentor changes the answer for both mentors and touches no
--      row; releasing the pupil keeps the rows.
--   3. Leaving the firm and account erasure leave no row behind; deleting the
--      chat deletes the check; the audit event stays.
--   4. Table constraints.
--   5. The migration re-runs over the final shape.
--   Then a negative control: a table that forgets the membership cascade
--   fails the deletion check.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingBacking.postgres.test.ts runs it locally.

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  chat uuid := gen_random_uuid();
  who text;
  uid uuid;
begin
  foreach who in array array['owner','admin','mentor_a','mentor_b','pupil','other_pupil','member','outsider'] loop
    uid := gen_random_uuid();
    insert into auth.users(id, email) values (uid, uid || '@example.test');
    perform set_config('litt.' || who, uid::text, true);
  end loop;
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', current_setting('litt.owner')::uuid),
    (other_org, 'Other synthetic firm', current_setting('litt.outsider')::uuid);
  insert into public.org_members(org_id, user_id, role)
    select org, current_setting('litt.' || w)::uuid, case w when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end
    from unnest(array['owner','admin','mentor_a','mentor_b','pupil','other_pupil','member']) w;
  insert into public.org_members(org_id, user_id, role)
    values (other_org, current_setting('litt.outsider')::uuid, 'owner');
  insert into public.training_mentors(org_id, user_id, designated_by) values
    (org, current_setting('litt.mentor_a')::uuid, current_setting('litt.owner')::uuid),
    (org, current_setting('litt.mentor_b')::uuid, current_setting('litt.owner')::uuid);
  insert into public.training_pupils(org_id, trainee_user_id, mentor_user_id, assigned_by) values
    (org, current_setting('litt.pupil')::uuid, current_setting('litt.mentor_a')::uuid, current_setting('litt.mentor_a')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, current_setting('litt.mentor_b')::uuid, current_setting('litt.mentor_b')::uuid);
  insert into public.training_stages(org_id, trainee_user_id, practice, stage, updated_by) values
    (org, current_setting('litt.pupil')::uuid, null, 'junior', current_setting('litt.mentor_a')::uuid),
    (org, current_setting('litt.other_pupil')::uuid, null, 'junior', current_setting('litt.mentor_b')::uuid);
  insert into public.chats(id, user_id, org_id) values (chat, current_setting('litt.pupil')::uuid, org);
  insert into public.training_backing_checks(org_id, trainee_user_id, chat_id, message_id, status, conclusions) values
    (org, current_setting('litt.pupil')::uuid, chat, gen_random_uuid(), 'ready',
      '[{"id":"c1","text":"t","citation_ref":null,"status":"unbacked","unverified_references":[],"person_verified":false,"person_note":null}]'),
    (org, current_setting('litt.other_pupil')::uuid, chat, gen_random_uuid(), 'pending', null);
  insert into public.audit_events(user_id, action, surface, detail)
    values (current_setting('litt.pupil')::uuid, 'training.backing_verified', 'organization',
      jsonb_build_object('org_id', org, 'target_user_id', current_setting('litt.pupil')));
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.other_org', other_org::text, true);
  perform set_config('litt.chat', chat::text, true);
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

-- Who of the actors reads the pupil's learning data, as a sorted list.
create function pg_temp.readers(p_trainee text) returns text language sql as $$
  select coalesce(string_agg(w, ',' order by w), '') from unnest(
    array['owner','admin','mentor_a','mentor_b','pupil','other_pupil','member','outsider']) w
  where public.training_can_read_learning(
    current_setting('litt.' || w)::uuid, current_setting('litt.org')::uuid, current_setting('litt.' || p_trainee)::uuid);
$$;

-- 1. Reach.
begin;
select pg_temp.fixture();
do $$
begin
  assert pg_temp.readers('pupil') = 'mentor_a,pupil', 'readers of the pupil: ' || pg_temp.readers('pupil');
  assert pg_temp.readers('other_pupil') = 'mentor_b,other_pupil', 'readers of the other pupil: ' || pg_temp.readers('other_pupil');
  assert (select relrowsecurity from pg_class where oid = 'public.training_backing_checks'::regclass), 'RLS is on';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
      unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(r, 'public.training_backing_checks', p)), 'no browser privilege';
  assert has_table_privilege('service_role', 'public.training_backing_checks', 'select')
    and has_table_privilege('service_role', 'public.training_backing_checks', 'update'), 'the backend writes it';
  assert not exists (select 1 from pg_policy where polrelid = 'public.training_backing_checks'::regclass), 'no policies';
  assert (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'training_backing_checks' and column_name = 'trainee_user_id') = 1,
    'the generic discovery of training_* tables finds it';
end;
$$;
rollback;

-- 2. Changing the mentor, and releasing the pupil.
begin;
select pg_temp.fixture();
do $$
declare before_rows bigint;
begin
  select count(*) into before_rows from public.training_backing_checks;
  update public.training_pupils set mentor_user_id = current_setting('litt.mentor_b')::uuid, assigned_by = current_setting('litt.owner')::uuid
    where trainee_user_id = current_setting('litt.pupil')::uuid;
  assert pg_temp.readers('pupil') = 'mentor_b,pupil', 'after reassigning: ' || pg_temp.readers('pupil');
  assert (select count(*) from public.training_backing_checks) = before_rows, 'reassigning touches no row';
  assert (select count(*) from public.training_backing_checks where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'the check is still the pupil''s';
  delete from public.training_pupils where trainee_user_id = current_setting('litt.pupil')::uuid;
  assert pg_temp.readers('pupil') = 'pupil', 'a released pupil is read by nobody else: ' || pg_temp.readers('pupil');
  assert (select count(*) from public.training_backing_checks where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'releasing the pupil keeps the check';
end;
$$;
rollback;

-- 3a. Leaving the firm.
begin;
select pg_temp.fixture();
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
begin
  assert (select count(*) from public.training_backing_checks where trainee_user_id = current_setting('litt.pupil')::uuid) = 0,
    'after leaving: no check of the pupil remains';
  assert (select count(*) from public.training_backing_checks where trainee_user_id = current_setting('litt.other_pupil')::uuid) = 1,
    'after leaving: the other pupil''s check is untouched';
  assert (select count(*) from public.audit_events
    where detail->>'target_user_id' = current_setting('litt.pupil')) = 1, 'the audit event stays';
end;
$$;
rollback;

-- 3b. Account erasure.
begin;
select pg_temp.fixture();
select public.prepare_account_org_departures(current_setting('litt.pupil')::uuid);
delete from auth.users where id = current_setting('litt.pupil')::uuid;
do $$
begin
  assert (select count(*) from public.training_backing_checks where trainee_user_id = current_setting('litt.pupil')::uuid) = 0,
    'after erasure: no check remains';
  assert (select count(*) from public.audit_events
    where detail->>'target_user_id' = current_setting('litt.pupil')) = 1, 'the audit event stays';
end;
$$;
rollback;

-- 3c. Deleting the chat deletes the checks of its messages.
begin;
select pg_temp.fixture();
delete from public.chats where id = current_setting('litt.chat')::uuid;
do $$
begin
  assert (select count(*) from public.training_backing_checks) = 0, 'the checks go with their chat';
end;
$$;
rollback;

-- 4. Constraints.
begin;
select pg_temp.fixture();
do $$
declare
  ins text := format('insert into public.training_backing_checks(org_id,trainee_user_id,%%s) values (%L,%L,%%s)',
    current_setting('litt.org'), current_setting('litt.pupil'));
  chat text := quote_literal(current_setting('litt.chat'));
  thirteen jsonb := (select jsonb_agg(jsonb_build_object('id', 'c' || n)) from generate_series(1, 13) n);
begin
  -- Exactly one chat.
  perform pg_temp.rejects(format(ins, 'message_id', quote_literal(gen_random_uuid())), 'training_backing_checks_one_chat');
  perform pg_temp.rejects(format(ins, 'chat_id,word_chat_id,message_id', chat || ',' || chat || ',' || quote_literal(gen_random_uuid())),
    'training_backing_checks_one_chat');
  -- One check per message.
  perform pg_temp.rejects(format(ins, 'chat_id,message_id', chat || ',' || quote_literal((select message_id from public.training_backing_checks limit 1))),
    'training_backing_checks_message_key');
  -- Status, and conclusions exactly when ready.
  perform pg_temp.rejects(format(ins, 'chat_id,message_id,status', chat || ',' || quote_literal(gen_random_uuid()) || ',''listo'''),
    'training_backing_checks_status_check');
  perform pg_temp.rejects(format(ins, 'chat_id,message_id,status', chat || ',' || quote_literal(gen_random_uuid()) || ',''ready'''),
    'training_backing_checks_conclusions_check');
  perform pg_temp.rejects(format(ins, 'chat_id,message_id,conclusions', chat || ',' || quote_literal(gen_random_uuid()) || ',''[]'''),
    'training_backing_checks_conclusions_check');
  perform pg_temp.rejects(format(ins, 'chat_id,message_id,status,conclusions', chat || ',' || quote_literal(gen_random_uuid()) || ',''ready'',''{"a":1}'''),
    'training_backing_checks_conclusions_check');
  perform pg_temp.rejects(format(ins, 'chat_id,message_id,status,conclusions',
    chat || ',' || quote_literal(gen_random_uuid()) || ',''ready'',' || quote_literal(thirteen)), 'training_backing_checks_conclusions_check');
  -- Only a member of the firm.
  perform pg_temp.rejects(format('insert into public.training_backing_checks(org_id,trainee_user_id,chat_id,message_id) values (%L,%L,%L,%L)',
    current_setting('litt.other_org'), current_setting('litt.pupil'), current_setting('litt.chat'), gen_random_uuid()),
    'training_backing_checks_member_fkey');
end;
$$;
rollback;

-- 5. The migration re-runs over the final shape, twice.
\ir ../../../migrations/20261108_64_litt_training_criterion_backing.sql
\ir ../../../migrations/20261108_64_litt_training_criterion_backing.sql
begin;
select pg_temp.fixture();
do $$
begin
  assert (select count(*) from public.training_backing_checks) = 2, 'the rows survive a re-run';
  assert pg_temp.readers('pupil') = 'mentor_a,pupil', 'after re-running the migration';
  assert (select relrowsecurity from pg_class where oid = 'public.training_backing_checks'::regclass), 'RLS stays on';
  assert not has_table_privilege('authenticated', 'public.training_backing_checks', 'select'), 'still closed to the browser';
end;
$$;
rollback;

-- Negative control: a table without the membership cascade leaves rows behind.
begin;
select pg_temp.fixture();
alter table public.training_backing_checks drop constraint training_backing_checks_member_fkey;
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
begin
  assert (select count(*) from public.training_backing_checks where trainee_user_id = current_setting('litt.pupil')::uuid) = 1,
    'control: without the cascade the pupil''s check stays, so the deletion check above catches it';
end;
$$;
rollback;

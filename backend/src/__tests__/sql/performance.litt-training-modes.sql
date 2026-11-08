-- LiTT training layer 3, card 6: the notes that hints and counterparty rounds
-- write (columns from 20261108_60_litt_training_criterion_turns.sql).
--
--   1. The exact shapes lib/trainingTurn writes are accepted: a hint (mode,
--      step 1..3, no mark, 'skipped', no contrast), a counterpart turn
--      ('skipped'), the close of a round ('pending', then 'ready' with its
--      contrast) and an ordinary turn (no mode).
--   2. What the server never writes is rejected: a mode without a step, a step
--      without a mode, a fourth rung, an unknown mode, 'skipped' with a contrast.
--   3. The ladder's own read (the person's notes of one chat, newest first)
--      returns the run the server counts, and not another person's.
--   4. The notes go with the pupil's membership (they are learning data).
--
-- Runs in CI with the performance.*.sql loop on a fresh schema.sql, and
-- locally through trainingModes.postgres.test.ts.
begin;

create function pg_temp.rejects(stmt text, expected text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    assert sqlerrm like '%' || expected || '%', 'expected ' || expected || ' but got: ' || sqlerrm;
    return;
  end;
  raise exception 'expected % to reject: %', expected, stmt;
end;
$$;

do $$
declare
  owner uuid := gen_random_uuid(); pupil uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  org uuid := gen_random_uuid(); chat uuid := gen_random_uuid(); other_chat uuid := gen_random_uuid();
  t timestamptz := now() - interval '1 hour';
  ins text;
  ladder text;
begin
  insert into auth.users(id, email) values
    (owner, owner || '@example.test'), (pupil, pupil || '@example.test'), (other, other || '@example.test');
  insert into public.organizations(id, name, created_by) values (org, 'Synthetic firm', owner);
  insert into public.org_members(org_id, user_id, role) values
    (org, owner, 'owner'), (org, pupil, 'member'), (org, other, 'member');
  insert into public.chats(id, user_id, org_id) values (chat, pupil, org), (other_chat, other, org);
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.pupil', pupil::text, true);
  perform set_config('litt.chat', chat::text, true);

  -- 1. The shapes the server writes.
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt, confidence, mode, step, contrast_status, created_at)
  values
    (org, pupil, chat, gen_random_uuid(), repeat('a', 60), null, 'hint', 1, 'skipped', t + interval '1 minute'),
    (org, pupil, chat, gen_random_uuid(), repeat('b', 60), null, 'hint', 2, 'skipped', t + interval '2 minutes'),
    (org, pupil, chat, gen_random_uuid(), repeat('c', 60), null, 'hint', 3, 'skipped', t + interval '3 minutes'),
    (org, pupil, chat, gen_random_uuid(), repeat('d', 60), 3, null, null, 'pending', t + interval '4 minutes'),
    (org, pupil, chat, gen_random_uuid(), repeat('e', 60), 3, 'counterpart', 1, 'skipped', t + interval '5 minutes'),
    (org, pupil, chat, gen_random_uuid(), repeat('f', 60), 3, 'counterpart', 2, 'skipped', t + interval '6 minutes');
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt, confidence, mode, step, contrast_status, created_at)
    values (org, pupil, chat, gen_random_uuid(), repeat('g', 60), 3, 'counterpart_close', 2, 'pending', t + interval '7 minutes');
  update public.training_turn_notes
    set contrast = E'Sostuviste\n- Uno\nConcediste\n- Dos\nFaltó defender\n- Tres', contrast_status = 'ready'
    where mode = 'counterpart_close' and contrast_status = 'pending';
  insert into public.training_turn_notes(org_id, trainee_user_id, chat_id, message_id, attempt, mode, step, contrast_status, created_at)
    values (org, other, other_chat, gen_random_uuid(), repeat('z', 60), 'hint', 1, 'skipped', t + interval '8 minutes');

  -- 2. What the server never writes.
  ins := format('insert into public.training_turn_notes(org_id,trainee_user_id,chat_id,message_id,attempt,%%s) values (%L,%L,%L,gen_random_uuid(),repeat(''x'',60),%%s)', org, pupil, chat);
  perform pg_temp.rejects(format(ins, 'mode', '''hint'''), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'step', '1'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'mode,step', '''hint'',4'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'mode,step', '''hint'',0'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'mode,step', '''criteria_contrast'',1'), 'training_turn_notes_mode_check');
  perform pg_temp.rejects(format(ins, 'contrast_status,contrast', '''skipped'',''algo'''), 'training_turn_notes_contrast_check');

  -- 3. The ladder's read: the person's own notes of the chat, newest first.
  select string_agg(coalesce(mode, '-') || coalesce(step::text, ''), ' ' order by created_at desc)
    into ladder
  from (
    select mode, step, created_at from public.training_turn_notes
    where trainee_user_id = pupil and chat_id = chat order by created_at desc limit 8
  ) q;
  assert ladder = 'counterpart_close2 counterpart2 counterpart1 - hint3 hint2 hint1',
    'the ladder read returned: ' || coalesce(ladder, 'null');

  assert (select count(*) from public.training_turn_notes where trainee_user_id = other) = 1,
    'the other person keeps their own note';
end;
$$;

-- 4. The notes of a mode go with the membership.
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.pupil')::uuid,
  current_setting('litt.pupil')::uuid, null);
do $$
begin
  assert (select count(*) from public.training_turn_notes
    where trainee_user_id = current_setting('litt.pupil')::uuid) = 0,
    'the pupil''s notes of hints and rounds must go with the membership';
end;
$$;

rollback;

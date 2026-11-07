-- LiTT 20261107_54_litt_playbook_change_guards: one running proposal per
-- copy; a change accepted in one transaction over the version read; a failed
-- proposal's documents removed only from a copy still in draft, and only its
-- own. The interleavings under concurrency are in
-- backend/scripts/test-playbook-change-concurrency.mjs. Synthetic rows,
-- rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  copy uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  change uuid := gen_random_uuid();
  second_change uuid := gen_random_uuid();
  mine uuid := gen_random_uuid();
  theirs uuid := gen_random_uuid();
  read_version timestamptz;
  refused boolean;
begin
  insert into auth.users(id, email) values (owner_id, owner_id || '@example.test');
  insert into public.playbooks(id, user_id, name, content_json, status)
    values (copy, owner_id, 'Copy', '{"name":"Copy"}', 'draft'),
           (other, owner_id, 'Other', '{"name":"Other"}', 'draft');

  -- One running proposal per copy; a finished one, or an import, does not count.
  insert into public.playbook_imports(user_id, filename, model, status, stage, started_at, kind, playbook_id)
    values (owner_id, '', 'model', 'running', 'compiling', now(), 'proposal', copy);
  begin
    insert into public.playbook_imports(user_id, filename, model, status, stage, started_at, kind, playbook_id)
      values (owner_id, '', 'model', 'running', 'checking_model', now(), 'proposal', copy);
    refused := false;
  exception when unique_violation then refused := true;
  end;
  assert refused, 'a second running proposal over one copy is refused';
  insert into public.playbook_imports(user_id, filename, model, status, stage, started_at, kind, playbook_id)
    values (owner_id, '', 'model', 'failed', 'compiling', now(), 'proposal', copy),
           (owner_id, '', 'model', 'running', 'compiling', now(), 'proposal', other),
           (owner_id, 'x.docx', 'model', 'running', 'compiling', now(), 'import', copy);

  -- Accepting: over the version read, once.
  insert into public.playbook_changes(id, playbook_id, op, rule_id)
    values (change, copy, 'add_rule', 'r1'), (second_change, copy, 'add_rule', 'r2');
  select updated_at into read_version from public.playbooks where id = copy;
  assert public.accept_playbook_change(copy, change, owner_id, read_version - interval '1 second', '{"name":"Lost"}') = 'stale',
    'a version other than the current one is stale';
  assert (select status = 'pending' and decided_at is null from public.playbook_changes where id = change),
    'a stale accept leaves the change pending';
  assert public.accept_playbook_change(copy, change, owner_id, read_version, '{"name":"Accepted"}') = 'accepted',
    'the version read accepts the change';
  assert (select status = 'accepted' and decided_by = owner_id and decided_at is not null
          from public.playbook_changes where id = change),
    'the change is accepted by its decider';
  assert (select content_json->>'name' = 'Accepted' and updated_at > read_version
          from public.playbooks where id = copy),
    'the rules and the version are saved with it';
  select updated_at into read_version from public.playbooks where id = copy;
  assert public.accept_playbook_change(copy, change, owner_id, read_version, '{"name":"Twice"}') = 'decided',
    'a decided change is not applied twice';
  assert public.accept_playbook_change(copy, second_change, owner_id, read_version, '{"name":"Wrong"}') = 'accepted'
         and public.accept_playbook_change(other, second_change, owner_id,
               (select updated_at from public.playbooks where id = other), '{"name":"Wrong"}') = 'decided',
    'a change is accepted only on its own playbook';
  assert (select content_json->>'name' = 'Other' from public.playbooks where id = other),
    'another playbook is untouched';
  assert public.accept_playbook_change(gen_random_uuid(), change, owner_id, now(), '{}') = 'missing',
    'a playbook that is gone is missing';

  -- A failed proposal's documents: only the listed ones of this copy, while a draft.
  insert into public.playbook_sources(id, playbook_id, filename, file_type, storage_key, size_bytes)
    values (mine, copy, 'Caso.docx', 'docx', 'copy-key', 10),
           (theirs, other, 'Otro.docx', 'docx', 'other-key', 10);
  update public.playbooks set status = 'ready' where id = copy;
  assert not exists (select 1 from public.discard_playbook_proposal_sources(copy, array[mine])),
    'a ready copy keeps its documents';
  assert exists (select 1 from public.playbook_sources where id = mine), 'still there';
  update public.playbooks set status = 'draft', is_model = false where id = copy;
  assert (select array_agg(key) = array['copy-key']
          from public.discard_playbook_proposal_sources(copy, array[mine, theirs]) as key),
    'only this copy''s listed documents go, with their storage keys';
  assert exists (select 1 from public.playbook_sources where id = theirs),
    'another playbook''s document is untouched';

  -- Backend-only.
  assert not has_function_privilege('authenticated',
    'public.accept_playbook_change(uuid, uuid, uuid, timestamptz, jsonb)', 'execute'),
    'browsers cannot accept a change directly';
  assert not has_function_privilege('anon',
    'public.discard_playbook_proposal_sources(uuid, uuid[])', 'execute'),
    'browsers cannot remove documents directly';
  assert has_function_privilege('service_role',
    'public.accept_playbook_change(uuid, uuid, uuid, timestamptz, jsonb)', 'execute'),
    'the backend can accept a change';
end;
$$;
rollback;

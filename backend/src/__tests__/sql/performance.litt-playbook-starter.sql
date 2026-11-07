-- LiTT 20261107_53_litt_playbook_starter: the database enforces a playbook's
-- draft/ready state and model mark, the kind of a playbook_imports row, and
-- the shape of a proposed change; playbook_changes is backend-only and goes
-- with its playbook. Synthetic rows, rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  original uuid := gen_random_uuid();
  copy uuid := gen_random_uuid();
  refused boolean;
begin
  insert into auth.users(id, email) values (owner_id, owner_id || '@example.test');

  -- A playbook written the way every existing one was: ready, not a model.
  insert into public.playbooks(id, user_id, name, content_json)
    values (original, owner_id, 'Original', '{"name":"Original"}');
  assert (select status = 'ready' and not is_model and derived_from_playbook_id is null
            and intake_json is null
          from public.playbooks where id = original),
    'an existing playbook stays ready and is not a model';
  update public.playbooks set is_model = true where id = original;

  begin
    insert into public.playbooks(user_id, name, content_json, status)
      values (owner_id, 'Bad', '{}', 'archived');
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'status is draft or ready';

  begin
    insert into public.playbooks(user_id, name, content_json, status, is_model)
      values (owner_id, 'Draft model', '{}', 'draft', true);
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'a draft cannot be a model';

  insert into public.playbooks(id, user_id, name, content_json, status, derived_from_playbook_id, intake_json)
    values (copy, owner_id, 'Copy', '{"name":"Copy"}', 'draft', original, '{"answers":{}}');

  begin
    update public.playbooks set is_model = true where id = copy;
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'a draft copy cannot be marked a model';

  -- playbook_imports: existing rows are imports; the kind is constrained.
  insert into public.playbook_imports(user_id, filename, model, status, stage, started_at)
    values (owner_id, 'policy.docx', 'model', 'running', 'compiling', now());
  assert (select bool_and(kind = 'import' and request_json is null)
          from public.playbook_imports where user_id = owner_id),
    'an import row defaults to kind import';
  begin
    insert into public.playbook_imports(user_id, filename, model, status, stage, started_at, kind)
      values (owner_id, '', 'model', 'running', 'compiling', now(), 'upload');
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'kind is import, draft or proposal';

  -- playbook_changes: the operation, status and decision are constrained.
  insert into public.playbook_changes(playbook_id, op, rule_id)
    values (copy, 'add_rule', 'rule-1');
  assert (select status = 'pending' and source = 'starting_point' and decided_at is null
          from public.playbook_changes where playbook_id = copy),
    'a proposed change starts pending';
  begin
    insert into public.playbook_changes(playbook_id, op, rule_id) values (copy, 'rename_rule', 'r');
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'op is add_rule, modify_rule or remove_rule';
  begin
    insert into public.playbook_changes(playbook_id, op, rule_id, source)
      values (copy, 'add_rule', 'r', 'document');
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'source is starting_point in layer 1';
  begin
    insert into public.playbook_changes(playbook_id, op, rule_id, status)
      values (copy, 'add_rule', 'r', 'accepted');
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'a decided change records when it was decided';
  begin
    insert into public.playbook_changes(playbook_id, op, rule_id, decided_at)
      values (copy, 'add_rule', 'r', now());
    refused := false;
  exception when check_violation then refused := true;
  end;
  assert refused, 'a pending change has no decision time';
  insert into public.playbook_changes(playbook_id, op, rule_id, status, decided_by, decided_at)
    values (copy, 'remove_rule', 'rule-2', 'rejected', owner_id, now());

  -- Backend-only, like the other playbook tables.
  assert (select relrowsecurity from pg_class where oid = 'public.playbook_changes'::regclass),
    'playbook_changes has row level security';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'playbook_changes'
      and grantee in ('anon', 'authenticated')),
    'browser roles have no grant on playbook_changes';
  assert not exists (select 1 from pg_policies where tablename = 'playbook_changes'),
    'playbook_changes has no browser policy';

  -- Deleting the original leaves the copy independent; deleting the copy
  -- takes its changes with it.
  delete from public.playbooks where id = original;
  assert (select derived_from_playbook_id is null from public.playbooks where id = copy),
    'the copy survives its original';
  delete from public.playbooks where id = copy;
  assert not exists (select 1 from public.playbook_changes where playbook_id = copy),
    'a playbook''s changes go with it';
end;
$$;
rollback;

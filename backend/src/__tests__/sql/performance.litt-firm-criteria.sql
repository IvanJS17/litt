-- LiTT training layer 3, the firm's criteria
-- (20261108_76_litt_firm_criteria.sql): firm_criteria is the FIRM's content,
-- not learning data. These assertions are about what it is and is not.
--
--   1. The table is closed to the browser roles and has RLS; the backend
--      (service_role) uses it. Every row belongs to one organization and a
--      read scoped by org_id never returns another firm's criterion.
--   2. Constraints: closed kinds, bounded and non-blank text, a normalized
--      practice area, and a dissenting opinion that names a rule (a plain
--      criterion names none).
--   3. The criterion belongs to the firm: leaving the firm and erasing the
--      author's account leave it, with the author gone from the second;
--      deleting the playbook unlinks a dissenting opinion but keeps its rule
--      id. (A team organization is never deleted outright, only soft-deleted,
--      so there is nothing to assert about its removal.)
--   4. It is not learning data: no pupil column, and no training_* name, so the
--      learning rule and the generic training_* discovery never apply to it.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; firmCriteria.postgres.test.ts runs it locally and
-- proves it depends on the grants, the constraints and the author's set null.

create function pg_temp.fixture() returns void language plpgsql as $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); partner uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  playbook uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values
    (owner_id, owner_id || '@example.test'), (partner, partner || '@example.test'), (outsider, outsider || '@example.test');
  insert into public.organizations(id, name, created_by) values
    (org, 'Synthetic firm', owner_id), (other_org, 'Other synthetic firm', outsider);
  insert into public.org_members(org_id, user_id, role) values
    (org, owner_id, 'owner'), (org, partner, 'member'), (other_org, outsider, 'owner');
  insert into public.playbooks(id, user_id, org_id, visibility, name, content_json)
    values (playbook, owner_id, org, 'organization', 'Synthetic playbook', '{}'::jsonb);
  insert into public.firm_criteria(org_id, author_user_id, kind, practice, topic, position) values
    (org, partner, 'criterio', 'mercantil', 'Prescripción', 'El plazo corre desde el vencimiento.'),
    (other_org, outsider, 'criterio', null, 'Prescripción', 'Otra postura de otro despacho.');
  insert into public.firm_criteria(org_id, author_user_id, kind, topic, position, playbook_id, rule_id)
    values (org, partner, 'voto_particular', 'Intereses', 'Discrepo de la regla.', playbook, 'r1');
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.other_org', other_org::text, true);
  perform set_config('litt.owner', owner_id::text, true);
  perform set_config('litt.partner', partner::text, true);
  perform set_config('litt.outsider', outsider::text, true);
  perform set_config('litt.playbook', playbook::text, true);
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

-- 1. Closed to the browser roles, scoped by organization, not learning data.
begin;
select pg_temp.fixture();
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.firm_criteria'::regclass), 'RLS is on';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
      unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(r, 'public.firm_criteria', p)),
    'a browser role has a privilege on firm_criteria';
  assert has_table_privilege('service_role', 'public.firm_criteria', 'SELECT')
    and has_table_privilege('service_role', 'public.firm_criteria', 'UPDATE'), 'the backend uses the table';
  assert not exists (select 1 from pg_policies where tablename = 'firm_criteria'), 'no policy opens it';
  assert (select count(*) from public.firm_criteria where org_id = current_setting('litt.org')::uuid) = 2,
    'a read scoped to the firm returns its own criteria';
  assert not exists (select 1 from public.firm_criteria where org_id = current_setting('litt.org')::uuid
    and position like '%otro despacho%'), 'and not another firm''s';
  -- It is the firm's content: no pupil column, and not a training_* table.
  assert not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'firm_criteria' and column_name in ('trainee_user_id', 'mentor_user_id')), 'no pupil column';
  assert not exists (select 1 from information_schema.table_constraints where table_schema = 'public'
    and table_name = 'firm_criteria' and constraint_type = 'FOREIGN KEY' and constraint_name like '%member%'),
    'it does not hang from a membership';
end;
$$;
set local role authenticated;
select pg_temp.rejects('select count(*) from public.firm_criteria', 'permission denied');
set local role anon;
select pg_temp.rejects('select count(*) from public.firm_criteria', 'permission denied');
rollback;

-- 2. Constraints.
begin;
select pg_temp.fixture();
do $$
declare
  org text := current_setting('litt.org');
  me text := current_setting('litt.partner');
  pb text := current_setting('litt.playbook');
begin
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,kind,topic,position) values (%L,%L,%L,%L,%L)',
    org, me, 'tesis', 't', 'p'), 'firm_criteria_kind_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    org, me, '   ', 'p'), 'firm_criteria_text_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    org, me, repeat('x', 121), 'p'), 'firm_criteria_text_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    org, me, 't', ''), 'firm_criteria_text_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    org, me, 't', repeat('x', 2001)), 'firm_criteria_text_check');
  execute format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    org, me, repeat('x', 120), repeat('y', 2000));
  -- The practice area is stored normalized, like training_stages.practice.
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,practice,topic,position) values (%L,%L,%L,%L,%L)',
    org, me, ' Civil ', 't', 'p'), 'firm_criteria_text_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,practice,topic,position) values (%L,%L,%L,%L,%L)',
    org, me, '', 't', 'p'), 'firm_criteria_text_check');
  -- A plain criterion names no rule; a dissenting opinion names one.
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position,rule_id) values (%L,%L,%L,%L,%L)',
    org, me, 't', 'p', 'r1'), 'firm_criteria_rule_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position,playbook_id) values (%L,%L,%L,%L,%L)',
    org, me, 't', 'p', pb), 'firm_criteria_rule_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,kind,topic,position) values (%L,%L,%L,%L,%L)',
    org, me, 'voto_particular', 't', 'p'), 'firm_criteria_rule_check');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,kind,topic,position,rule_id) values (%L,%L,%L,%L,%L,%L)',
    org, me, 'voto_particular', 't', 'p', repeat('r', 101)), 'firm_criteria_rule_check');
  -- An unknown organization or author is refused.
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    gen_random_uuid(), me, 't', 'p'), 'firm_criteria_org_id_fkey');
  perform pg_temp.rejects(format('insert into public.firm_criteria(org_id,author_user_id,topic,position) values (%L,%L,%L,%L)',
    org, gen_random_uuid(), 't', 'p'), 'firm_criteria_author_user_id_fkey');
end;
$$;
rollback;

-- 3a. Leaving the firm leaves the criterion: it is the firm's.
begin;
select pg_temp.fixture();
select public.remove_org_member(current_setting('litt.org')::uuid, current_setting('litt.partner')::uuid,
  current_setting('litt.partner')::uuid, null);
do $$
begin
  assert (select count(*) from public.firm_criteria where org_id = current_setting('litt.org')::uuid) = 2,
    'leaving the firm leaves its criteria';
end;
$$;
rollback;

-- 3b. Erasing the author's account leaves the criterion, without an author;
-- the audit stays.
begin;
select pg_temp.fixture();
do $$
begin
  insert into public.audit_events(user_id, action, surface, detail)
    values (current_setting('litt.partner')::uuid, 'firm_criteria.created', 'organization',
      jsonb_build_object('org_id', current_setting('litt.org'), 'kind', 'criterio'));
end;
$$;
select public.prepare_account_org_departures(current_setting('litt.partner')::uuid);
delete from auth.users where id = current_setting('litt.partner')::uuid;
do $$
begin
  assert (select count(*) from public.firm_criteria where org_id = current_setting('litt.org')::uuid) = 2,
    'erasing the account leaves the firm''s criteria';
  assert (select count(*) from public.firm_criteria where org_id = current_setting('litt.org')::uuid
    and author_user_id is null) = 2, 'with no author';
  assert (select count(*) from public.audit_events where action = 'firm_criteria.created') = 1, 'the audit stays';
end;
$$;
rollback;

-- 3c. The playbook going away unlinks a dissenting opinion, which keeps its rule id.
begin;
select pg_temp.fixture();
delete from public.playbooks where id = current_setting('litt.playbook')::uuid;
do $$
begin
  assert (select count(*) from public.firm_criteria where kind = 'voto_particular'
    and playbook_id is null and rule_id = 'r1') = 1, 'the dissenting opinion stays, unlinked, with its rule id';
end;
$$;
rollback;

-- LiTT training layer 3, bulk review designer
-- (20261108_66_litt_training_criterion_review_audits.sql): what the table
-- refuses, so the audit never keeps the content of a cell and the mentor's
-- evaluation is coherent.
--
--   1. The sample holds identifiers, a digest and marks only: any other key
--      (a cell's summary, its text), a bad mark, a note over 500 characters,
--      an empty or oversized sample and a non-array are refused.
--   2. Status and completed_at agree; the evaluation is set together
--      (outcome, time) and a note needs an outcome.
--   3. One live audit per person and review; a stale one does not count.
--   4. The audit is the person's: it needs the org_members row (a stranger is
--      refused), and goes with the review and with the membership.
--   5. No privilege for the browser roles; the backend role has all.
--
-- The generic learning-table checks of performance.litt-training-supervision.sql
-- cover RLS, the role grants and deletion with the membership.
--
-- Runs in CI with the performance.*.sql loop (.github/workflows/schema-drift.yml)
-- on a fresh schema.sql; trainingReviewAudit.postgres.test.ts runs it locally.

begin;

create function pg_temp.sample(p_item jsonb) returns jsonb language sql as $$
  select jsonb_build_array(p_item);
$$;

create function pg_temp.item(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row_id', gen_random_uuid(), 'column_index', 1, 'digest', '0123456789abcdef') || p_extra;
$$;

-- p_sql must fail with the constraint named p_needle.
create function pg_temp.rejects(p_sql text, p_needle text) returns void language plpgsql as $$
declare rejected boolean := false; c text; m text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics c = constraint_name, m = message_text;
    rejected := true;
    assert coalesce(c, '') = p_needle or m like '%' || p_needle || '%',
      format('%s: refused by %s (%s), not by %s', p_sql, c, m, p_needle);
  end;
  assert rejected, format('%s: should have been refused', p_sql);
end;
$$;

do $$
declare
  org uuid := gen_random_uuid(); stranger_org uuid := gen_random_uuid();
  u uuid := gen_random_uuid(); owner_id uuid := gen_random_uuid(); mentor_id uuid := gen_random_uuid();
  review uuid := gen_random_uuid(); id1 uuid; id2 uuid;
  base text;
begin
  insert into auth.users(id, email) values (u, u || '@example.test'), (owner_id, owner_id || '@example.test'), (mentor_id, mentor_id || '@example.test');
  insert into public.organizations(id, name, created_by) values (org, 'Synthetic firm', owner_id);
  insert into public.org_members(org_id, user_id, role) values (org, owner_id, 'owner'), (org, u, 'member'), (org, mentor_id, 'member');
  insert into public.tabular_reviews(id, user_id, org_id, title) values (review, owner_id, org, 'Synthetic review');
  perform set_config('litt.u', u::text, true);
  perform set_config('litt.org', org::text, true);
  perform set_config('litt.review', review::text, true);

  base := format($f$insert into public.training_review_audits
      (org_id, trainee_user_id, tabular_review_id, columns_snapshot, lint, seed, sample%%s)
      values (%L, %L, %L, '[]', '[]', 'seed', %%s%%s)$f$, org, u, review);

  -- 1. The sample.
  insert into public.training_review_audits(org_id, trainee_user_id, tabular_review_id, columns_snapshot, lint, seed, sample)
    values (org, u, review, '[]', '[]', 'seed', pg_temp.sample(pg_temp.item('{"mark":"incorrect","note":"ok","mentor_mark":"correct"}')))
    returning id into id1;
  delete from public.training_review_audits where id = id1;
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item('{"summary":"El contenido"}'))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item('{"content":"x"}'))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item('{"mark":"great"}'))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item('{"mentor_mark":"great"}'))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item(jsonb_build_object('note', repeat('x', 501))))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item('{"note":5}'))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal('{"row_id":"x"}') || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal('[]') || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal('["text"]') || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal('[{"row_id":"a","column_index":"1","digest":"d"}]') || '::jsonb', ''), 'training_review_audits_sample_check');
  perform pg_temp.rejects(format(base, '', quote_literal((select jsonb_agg(pg_temp.item()) from generate_series(1, 21))::text) || '::jsonb', ''), 'training_review_audits_sample_check');
  assert (select pg_catalog.count(*) from public.training_review_audits) = 0, 'nothing was kept';

  -- 2. Status and evaluation.
  insert into public.training_review_audits(org_id, trainee_user_id, tabular_review_id, columns_snapshot, lint, seed, sample)
    values (org, u, review, '[]', '[]', 'seed', pg_temp.sample(pg_temp.item())) returning id into id1;
  perform pg_temp.rejects(format('update public.training_review_audits set status = %L where id = %L', 'complete', id1), 'training_review_audits_status_check');
  perform pg_temp.rejects(format('update public.training_review_audits set status = %L, completed_at = now() where id = %L', 'open', id1), 'training_review_audits_status_check');
  perform pg_temp.rejects(format('update public.training_review_audits set status = %L where id = %L', 'done', id1), 'training_review_audits_status_check');
  perform pg_temp.rejects(format('update public.training_review_audits set mentor_outcome = %L where id = %L', 'adequate', id1), 'training_review_audits_evaluation_check');
  perform pg_temp.rejects(format('update public.training_review_audits set mentor_outcome = %L, evaluated_at = now() where id = %L', 'great', id1), 'training_review_audits_evaluation_check');
  perform pg_temp.rejects(format('update public.training_review_audits set mentor_note = %L where id = %L', 'sin resultado', id1), 'training_review_audits_evaluation_check');
  perform pg_temp.rejects(format('update public.training_review_audits set mentor_outcome = %L, evaluated_at = now(), mentor_note = %L where id = %L', 'adequate', repeat('x', 501), id1), 'training_review_audits_evaluation_check');
  perform pg_temp.rejects(format('update public.training_review_audits set evaluated_by = %L where id = %L', mentor_id, id1), 'training_review_audits_evaluation_check');
  update public.training_review_audits set status = 'complete', completed_at = now(),
      mentor_outcome = 'needs_work', evaluated_at = now(), mentor_note = repeat('x', 500), evaluated_by = mentor_id
    where id = id1;
  perform pg_temp.rejects(format('update public.training_review_audits set seed = %L where id = %L', '', id1), 'training_review_audits_snapshot_check');
  perform pg_temp.rejects(format('update public.training_review_audits set columns_snapshot = %L where id = %L', '{}', id1), 'training_review_audits_snapshot_check');

  -- 3. One live audit per person and review.
  perform pg_temp.rejects(format(base, '', quote_literal(pg_temp.sample(pg_temp.item())::text) || '::jsonb', ''), 'training_review_audits_live_idx');
  update public.training_review_audits set status = 'stale' where id = id1;
  insert into public.training_review_audits(org_id, trainee_user_id, tabular_review_id, columns_snapshot, lint, seed, sample)
    values (org, u, review, '[]', '[]', 'seed', pg_temp.sample(pg_temp.item())) returning id into id2;
  assert (select pg_catalog.count(*) from public.training_review_audits where trainee_user_id = u) = 2,
    'a stale audit stays as history next to the live one';
  -- Deleting the evaluator's account keeps the audit and clears who evaluated.
  delete from public.org_members where org_id = org and user_id = mentor_id;
  delete from auth.users where id = mentor_id;
  assert (select evaluated_by from public.training_review_audits where id = id1) is null
    and (select mentor_outcome from public.training_review_audits where id = id1) = 'needs_work',
    'the evaluation outlives the evaluator''s account';

  -- 4. Membership and review.
  perform pg_temp.rejects(format('insert into public.training_review_audits (org_id, trainee_user_id, tabular_review_id, columns_snapshot, lint, seed, sample) values (%L, %L, %L, %L, %L, %L, %L::jsonb)',
    stranger_org, u, review, '[]', '[]', 'seed', pg_temp.sample(pg_temp.item())::text), 'training_review_audits_member_fkey');
  delete from public.tabular_reviews where id = review;
  assert (select pg_catalog.count(*) from public.training_review_audits) = 0, 'the audits go with their review';
  insert into public.tabular_reviews(id, user_id, org_id, title) values (review, null, org, 'Synthetic review');
  insert into public.training_review_audits(org_id, trainee_user_id, tabular_review_id, columns_snapshot, lint, seed, sample)
    values (org, u, review, '[]', '[]', 'seed', pg_temp.sample(pg_temp.item()));
  delete from public.org_members where org_id = org and user_id = u;
  assert (select pg_catalog.count(*) from public.training_review_audits) = 0, 'the audits go with the membership';

  -- 5. Roles.
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
      unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(r, 'public.training_review_audits', p)),
    'the browser roles have no privilege';
  assert has_table_privilege('service_role', 'public.training_review_audits', 'INSERT')
    and has_table_privilege('service_role', 'public.training_review_audits', 'UPDATE'),
    'the backend writes the table';
  assert not has_function_privilege('anon', 'public.training_review_audit_sample_ok(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.training_review_audit_sample_ok(jsonb)', 'execute'),
    'the sample check is not callable by the browser roles';
end;
$$;

rollback;

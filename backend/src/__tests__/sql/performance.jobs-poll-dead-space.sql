-- L11b: an ordinary poll (no kind given) reads a number of job rows in
-- proportion to what it claims, whatever dead space the table carries.
--
-- claim_db_jobs is a LANGUAGE sql function, so its body is planned without its
-- argument values. A poll must therefore never run the kind-scoped arm:
-- planned as a walk in run_at order with the kind as a filter, it fetches
-- every pending row to find that none matches. This file is about a poll
-- only; a claim that names a kind is not measured here.
-- Which plan the planner prefers is a near tie that depends on how
-- much dead space earlier fixtures left in the table, so this file builds that
-- state itself, inside its own transaction, and pins the cost setting that
-- decides the tie. The outcome then no longer depends on the files that ran
-- before it or on when autovacuum ran.
begin;
-- Live rows a statement read from a table: sequential and bitmap heap reads
-- plus heap fetches through its indexes. Index entries alone are not counted.
create function pg_temp.rel_work(rel regclass) returns bigint language sql as $$
  select (pg_stat_get_xact_tuples_returned(rel)+pg_stat_get_xact_tuples_fetched(rel)
    +coalesce((select sum(pg_stat_get_xact_tuples_fetched(indexrelid)) from pg_index where indrelid=rel),0))::bigint;
$$;
create temporary table job_labels(id uuid,label text);
-- Cost of a random page fetch. With the planner's default (4) the two plans for
-- the kind-scoped arm differ by about two percent in the state built below, so
-- a host tuned for fast storage (a low value) hides the flaw and a slower one
-- shows it. A higher value keeps the state a fair one for a deployment whose
-- table is bigger than its cache, and makes the outcome independent of the
-- host's setting. It only changes which plan the planner prefers; the claim is
-- still judged by how many job rows it reads.
set local random_page_cost = 6;
-- Dead space: heap pages and index entries left by wide rows of mixed kinds
-- that were inserted and rolled back, and cannot be vacuumed in this
-- transaction.
savepoint dead_space;
insert into public.db_jobs(kind,status,payload)
  select (array['export.build','memory.consolidate','document.extract_text','document.precompute_text','other'])[1+n%5],
    (array['pending','running','done','failed'])[1+n%4],
    jsonb_build_object('userId',gen_random_uuid(),'actorUserId',gen_random_uuid(),'versionId',gen_random_uuid(),
      'base',jsonb_build_object('userId',gen_random_uuid()))
  from generate_series(1,5000) n;
rollback to savepoint dead_space;
do $$
declare before bigint; reads bigint; claimed text[];
begin
  assert (select pg_relation_size('public.db_jobs')/current_setting('block_size')::int)>=200,'the table carries dead space';
  -- The same live rows as performance.jobs.sql: a backlog of due work of one
  -- kind, plus one row on each other claim path, each earlier than the whole
  -- backlog, and rows no path may claim.
  insert into public.db_jobs(kind,run_at) select 'test.backlog',now()-interval '1 hour'+n*interval '1 ms' from generate_series(1,5000) n;
  with inserted as (
    insert into public.db_jobs(kind,status,run_at,claimed_at,attempts,max_attempts) values
      ('test.first','pending',now()-interval '5 hours',null,0,5),
      ('storage.cleanup','failed',now()-interval '4 hours',null,9,9),
      ('test.stale','running',now()-interval '3 hours',now()-interval '1 day',1,5),
      ('test.spent','running',now()-interval '6 hours',now()-interval '1 day',5,5),
      ('test.future','pending',now()+interval '1 hour',null,0,5),
      ('test.failed','failed',now()-interval '7 hours',null,5,5),
      ('test.kind','pending',now()-interval '2 minutes',null,0,5)
    returning id,kind)
  insert into job_labels select id,kind from inserted;
  analyze public.db_jobs;
  before:=pg_temp.rel_work('public.db_jobs');
  select array_agg(coalesce(l.label,'backlog') order by coalesce(l.label,'backlog')) into claimed
    from public.claim_db_jobs(5,600,null) j left join job_labels l on l.id=j.id;
  reads:=pg_temp.rel_work('public.db_jobs')-before;
  assert claimed=array['backlog','backlog','storage.cleanup','test.first','test.stale'],format('claimed %s',claimed);
  assert (select status='failed' from public.db_jobs where kind='test.spent'),'spent stale job is still abandoned';
  assert reads<200,format('one claim of 5 jobs read %s job rows',reads);
  -- The kind-scoped claim reads that kind's rows, in order.
  select array_agg(coalesce(l.label,'backlog') order by j.run_at) into claimed
    from public.claim_db_jobs(5,600,'test.kind') j left join job_labels l on l.id=j.id;
  assert claimed=array['test.kind'],format('kind claim %s',claimed);
  assert (select count(*)=4998 from public.db_jobs where kind='test.backlog' and status='pending'),'unclaimed rows stay pending';
end;
$$;
rollback;

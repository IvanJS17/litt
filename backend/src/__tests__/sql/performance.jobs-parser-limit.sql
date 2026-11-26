-- A claim that is given no free parser slot claims no parser-bound row and
-- still claims every other kind; a claim given one slot claims one.
-- Rows that were already in the table (pending, failed and revived, or stale
-- running ones) are set aside inside this transaction, so the claims below can
-- only see the rows this test inserts; the rollback restores them.
begin;
update public.db_jobs set run_at = now() + interval '1 day' where status in ('pending', 'failed');
update public.db_jobs set claimed_at = now() where status = 'running';
do $$
declare claimed text[];
begin
  insert into public.db_jobs(kind,payload,owner_key,run_at) values
    ('document.extract_text','{}','slot-a',now()-interval '60 years'),
    ('document.ocr','{}','slot-b',now()-interval '60 years'+interval '1 second'),
    ('document.precompute_text','{}','slot-c',now()-interval '60 years'+interval '2 seconds'),
    ('test.slot-other','{}',null,now()-interval '60 years'+interval '3 seconds');
  select array_agg(kind order by kind) into claimed from public.claim_db_jobs(5,600,null,0);
  assert claimed = array['test.slot-other'], format('no free slot claimed %s', claimed);
  assert (select count(*) = 3 from public.db_jobs
    where status = 'pending' and owner_key in ('slot-a','slot-b','slot-c')), 'parser rows stay pending';
  select array_agg(kind order by kind) into claimed from public.claim_db_jobs(5,600,null,1);
  assert cardinality(claimed) = 1 and claimed[1] like 'document.%', format('one free slot claimed %s', claimed);
end;
$$;
rollback;

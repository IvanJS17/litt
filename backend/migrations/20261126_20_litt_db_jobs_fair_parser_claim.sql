-- Migration date: 2026-11-26
-- Background work that needs the shared document parser (text extraction,
-- text precompute, scan reading) is claimed fairly per account. Until now every
-- pending row was claimed in global run_at order, so one account's backlog
-- of slow files kept every other account's rows behind it.
--
--  * db_jobs.owner_key: the owning user of a parser-bound row, stamped on
--    insert from the version the payload names. Rows with no resolvable
--    owner share one bucket.
--  * claim_db_jobs(p_parser_limit): parser-bound rows are claimed at most
--    one per owner, never for an owner that already has one running, the
--    owner served least recently first, and never more than the caller's
--    free parser slots. Other kinds are claimed in run_at order exactly as
--    before, and no longer queue behind parser-bound rows.
alter table public.db_jobs add column if not exists owner_key text;

create or replace function public.db_jobs_stamp_parser_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_key is null
     and new.kind in ('document.extract_text', 'document.precompute_text', 'document.ocr')
     and (new.payload->>'versionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select d.user_id::text into new.owner_key
      from public.document_versions v
      join public.documents d on d.id = v.document_id
     where v.id = (new.payload->>'versionId')::uuid;
  end if;
  return new;
end;
$$;
revoke all on function public.db_jobs_stamp_parser_owner()
  from public, anon, authenticated;
drop trigger if exists db_jobs_stamp_parser_owner on public.db_jobs;
create trigger db_jobs_stamp_parser_owner
  before insert on public.db_jobs
  for each row execute function public.db_jobs_stamp_parser_owner();

create index if not exists db_jobs_claim_other_idx
  on public.db_jobs (run_at)
  where status = 'pending'
    and kind not in ('document.extract_text', 'document.precompute_text', 'document.ocr');
create index if not exists db_jobs_parser_pending_idx
  on public.db_jobs (run_at)
  where status = 'pending'
    and kind in ('document.extract_text', 'document.precompute_text', 'document.ocr');
create index if not exists db_jobs_parser_owner_idx
  on public.db_jobs ((coalesce(owner_key, '')), claimed_at)
  where kind in ('document.extract_text', 'document.precompute_text', 'document.ocr');

drop function if exists public.claim_db_jobs(integer, integer, text);
create or replace function public.claim_db_jobs(
  p_limit integer default 5,
  p_stale_seconds integer default 600,
  p_kind text default null,
  -- Free parser slots of the calling runner; null means no limit beyond p_limit.
  p_parser_limit integer default null
)
returns setof public.db_jobs
language sql set search_path = ''
as $$
  with abandoned as (
    update public.db_jobs
       set status = 'failed',
           finished_at = now(),
           last_error = coalesce(
             last_error,
             'abandoned: worker died mid-run and attempts are exhausted'
           )
     where status = 'running'
       and claimed_at < now() - make_interval(secs => p_stale_seconds)
       and attempts >= max_attempts
       and kind not in ('storage.cleanup', 'document.cleanup')
    returning id
  ), candidates as (
    -- One arm per way a row can be claimable, each read in run_at order
    -- from its own partial index and stopped after p_limit unlocked rows,
    -- then merged. Each arm may lock up to p_limit rows it then does not
    -- claim; those stay locked only until this statement's transaction ends.
    select arms.id from (
      select * from (select id,run_at from public.db_jobs
        where p_kind is null and status = 'pending' and run_at <= now()
          and kind not in ('document.extract_text', 'document.precompute_text', 'document.ocr')
        order by run_at limit p_limit for update skip locked) pending_any
      union all
      select * from (select id,run_at from public.db_jobs
        where kind = p_kind and status = 'pending' and run_at <= now()
          and kind not in ('document.extract_text', 'document.precompute_text', 'document.ocr')
        order by run_at limit p_limit for update skip locked) pending_kind
      -- Parser-bound rows: the oldest due row of each owner that has none
      -- running, owners served least recently first, within the free slots.
      union all
      select * from (select id,run_at from public.db_jobs
        where id in (
          select first_rows.id from (
            select distinct on (due.owner) due.id, due.owner, due.run_at
              from (
                select id, run_at, coalesce(owner_key, '') as owner
                  from public.db_jobs p
                 where status = 'pending' and run_at <= now()
                   and kind in ('document.extract_text', 'document.precompute_text', 'document.ocr')
                   and (p_kind is null or kind = p_kind)
              ) due
             where not exists (
               select 1 from public.db_jobs r
                where r.status = 'running'
                  and r.kind in ('document.extract_text', 'document.precompute_text', 'document.ocr')
                  and coalesce(r.owner_key, '') = due.owner
                  and r.claimed_at >= now() - make_interval(secs => p_stale_seconds)
             )
             order by due.owner, due.run_at, due.id
          ) first_rows
          order by (
            select max(s.claimed_at) from public.db_jobs s
             where s.kind in ('document.extract_text', 'document.precompute_text', 'document.ocr')
               and coalesce(s.owner_key, '') = first_rows.owner
          ) nulls first, first_rows.run_at, first_rows.id
          limit greatest(0, least(p_limit, coalesce(p_parser_limit, p_limit)))
        )
          -- Repeated at the locking level: a row another session claimed
          -- after this statement began is re-checked against these.
          and status = 'pending' and run_at <= now()
          and kind in ('document.extract_text', 'document.precompute_text', 'document.ocr')
          and (p_kind is null or kind = p_kind)
        order by run_at for update skip locked) parser_pending
      -- Cleanup intents are retried forever, but politely: a revived
      -- `failed` row waits for its own run_at like everything else.
      union all
      select * from (select id,run_at from public.db_jobs
        where status = 'failed'
          and kind in ('storage.cleanup', 'document.cleanup')
          and run_at <= now()
          and (p_kind is null or kind = p_kind)
        order by run_at limit p_limit for update skip locked) failed_cleanup
      union all
      select * from (select id,run_at from public.db_jobs
        where status = 'running'
          and claimed_at < now() - make_interval(secs => p_stale_seconds)
          and (
            attempts < max_attempts
            or kind in ('storage.cleanup', 'document.cleanup')
          )
          and (p_kind is null or kind = p_kind)
        order by run_at limit p_limit for update skip locked) stale_running
    ) arms
    order by arms.run_at
    limit p_limit
  )
  update public.db_jobs j
     set status = 'running',
         claimed_at = now(),
         finished_at = null,
         attempts = case
           when j.kind in ('storage.cleanup', 'document.cleanup')
             then least(j.attempts::bigint + 1, 2147483647)::integer
           else j.attempts + 1
         end,
         max_attempts = case
           when j.kind in ('storage.cleanup', 'document.cleanup')
             then 2147483647
           else j.max_attempts
         end,
         run_at = case
           when j.status = 'failed'
             and j.kind in ('storage.cleanup', 'document.cleanup')
             then now() + least(
               interval '10 minutes',
               make_interval(secs => 30 * least(j.attempts::bigint + 1, 20))
             )
           else j.run_at
         end,
         dedupe_key = case
           when j.status = 'failed'
             and j.kind in ('storage.cleanup', 'document.cleanup')
             then null
           else j.dedupe_key
         end
   where j.id = any (array(select id from candidates))
  returning j.*;
$$;
revoke all on function public.claim_db_jobs(integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_db_jobs(integer, integer, text, integer)
  to service_role;

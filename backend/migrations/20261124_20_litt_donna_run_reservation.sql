-- Migration date: 2026-11-24
--
-- A Donna run takes its place before anything is sent. The firm's monthly cap
-- and a person's daily cap are checked, and the place is taken, in one step:
--
-- 1. matter_request_triage_reservations: one insert-only row per run, written
--    when the run starts (the runs table is written when it ends, and only if
--    it ends). No text, no title: ids and a time.
-- 2. public.reserve_donna_run: under a per-firm advisory lock, counts the
--    firm's places in the month window and the person's places in the day
--    window it is given, and inserts the place only when both are under their
--    cap. Returns 'ok', 'monthly_cap' or 'daily_cap'.
-- 3. Backfill: one place per existing run, so the month's count is the same
--    after this runs. It only runs while no place exists yet.

create table if not exists public.matter_request_triage_reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid,
  request_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists matter_request_triage_reservations_org_month_idx
  on public.matter_request_triage_reservations (org_id, created_at);
create index if not exists matter_request_triage_reservations_org_user_day_idx
  on public.matter_request_triage_reservations (org_id, user_id, created_at);

drop trigger if exists matter_request_triage_reservations_insert_only_trigger on public.matter_request_triage_reservations;
create trigger matter_request_triage_reservations_insert_only_trigger
  before update or delete on public.matter_request_triage_reservations
  for each row execute function public.matter_request_triage_insert_only();
drop trigger if exists matter_request_triage_reservations_no_truncate_trigger on public.matter_request_triage_reservations;
create trigger matter_request_triage_reservations_no_truncate_trigger
  before truncate on public.matter_request_triage_reservations
  for each statement execute function public.matter_request_triage_insert_only();

-- Only the backend reads and writes it: no policy for end users.
alter table public.matter_request_triage_reservations enable row level security;
revoke all on public.matter_request_triage_reservations from public, anon, authenticated;
grant select, insert on public.matter_request_triage_reservations to service_role;

create or replace function public.reserve_donna_run(
  p_org_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_month_start timestamptz,
  p_month_end timestamptz,
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_month_cap integer,
  p_day_cap integer
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  -- One firm at a time: the counts below and the insert cannot interleave
  -- with another run of the same firm. Released when the transaction ends.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('donna_run_reservation:' || p_org_id::text, 0)
  );
  if (select pg_catalog.count(*)
        from public.matter_request_triage_reservations r
       where r.org_id = p_org_id
         and r.created_at >= p_month_start
         and r.created_at < p_month_end) >= p_month_cap then
    return 'monthly_cap';
  end if;
  if (select pg_catalog.count(*)
        from public.matter_request_triage_reservations r
       where r.org_id = p_org_id
         and r.user_id = p_user_id
         and r.created_at >= p_day_start
         and r.created_at < p_day_end) >= p_day_cap then
    return 'daily_cap';
  end if;
  insert into public.matter_request_triage_reservations (org_id, user_id, request_id)
  values (p_org_id, p_user_id, p_request_id);
  return 'ok';
end;
$$;
revoke all on function public.reserve_donna_run(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_donna_run(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer)
  to service_role;

-- Backfill: one place per run that exists, with the run's own time. Only while
-- no place exists yet, so running this again never counts a run twice.
insert into public.matter_request_triage_reservations (org_id, user_id, request_id, created_at)
select r.org_id, r.started_by, r.request_id, r.created_at
  from public.matter_request_triage_runs r
 where not exists (select 1 from public.matter_request_triage_reservations);

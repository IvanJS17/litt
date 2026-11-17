-- Migration date: 2026-11-17
--
-- The record of a retainer report a lawyer says they sent to the client
-- (docs/retainer-report.md).
--
-- LiTT sends nothing: the report is a document the lawyer downloads and sends
-- by their own means. The only thing stored is the lawyer's own note that it
-- was sent, as an insert-only event:
--
--   matter_report_sent_events: who, when, which period (start, end, length in
--   calendar days) and an optional note. Several rows may exist for one period
--   (a report sent again). The report's content is never stored: it is computed
--   from confirmed data every time it is read.
--
-- The actor column has no foreign key to auth.users, so erasing an account is
-- never blocked by it. No column holds hours or an estimate.
--
-- Re-runnable: the table uses if not exists, constraints and triggers are
-- dropped before they are created, functions use create or replace.

create table if not exists public.matter_report_sent_events (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  period_days integer not null check (period_days in (30, 60, 90)),
  note text check (char_length(note) <= 500),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint matter_report_sent_events_period
    check (period_end >= period_start and period_end - period_start + 1 = period_days)
);
create index if not exists matter_report_sent_events_matter_idx
  on public.matter_report_sent_events (matter_id, created_at desc, id);

-- Insert-only; and a report belongs to a private retainer matter.
create or replace function public.matter_report_sent_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_report_sent_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.matters m
    where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
  ) then
    raise exception 'a retainer report belongs to a private retainer matter'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_report_sent_events_guard() from public, anon, authenticated;

drop trigger if exists matter_report_sent_events_guard_trigger on public.matter_report_sent_events;
create trigger matter_report_sent_events_guard_trigger
  before insert or update or delete on public.matter_report_sent_events
  for each row execute function public.matter_report_sent_events_guard();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter; every write is the
-- backend's (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.matter_report_sent_events enable row level security;

revoke all on public.matter_report_sent_events from public, anon, authenticated;
grant select on public.matter_report_sent_events to authenticated;
grant select, insert on public.matter_report_sent_events to service_role;

drop policy if exists matter_report_sent_events_select_member on public.matter_report_sent_events;
create policy matter_report_sent_events_select_member on public.matter_report_sent_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

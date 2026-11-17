-- Migration date: 2026-11-16
--
-- What the lawyers did with the deadline radar of a retainer matter
-- (docs/deadline-radar.md).
--
-- The radar itself is not stored: its items are computed, in code, every time
-- they are read, from the CONFIRMED and not stale facts of the client profile
-- (matter_profile_facts). Only a person's reaction to an item is kept:
--
--   matter_radar_item_events: insert-only record of 'ack' (seen), 'dismiss'
--   (not a deadline to track; a reason is required) and 'done'. An item is
--   named by (fact_id, item_type): a fact is never changed, so the same pair
--   names the same item for ever. `due_on` is the date the item had when the
--   person acted, kept as evidence; an event whose date no longer matches the
--   computed one is ignored by the code (the item was recomputed).
--
-- The actor column has no foreign key to auth.users, so erasing an account is
-- never blocked by it. No column holds hours. Nothing here computes a date.
--
-- Re-runnable: the table uses if not exists, constraints and triggers are
-- dropped before they are created, functions use create or replace.

create table if not exists public.matter_radar_item_events (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null,
  fact_id uuid not null,
  item_type text not null check (item_type in ('expiry', 'notice', 'power_expiry')),
  action text not null check (action in ('ack', 'dismiss', 'done')),
  -- The computed date of the item when the person acted; null for an item
  -- that had no date (a business-day notice left for review).
  due_on date,
  reason text check (char_length(reason) <= 500),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint matter_radar_item_events_fact_fk
    foreign key (fact_id, matter_id) references public.matter_profile_facts(id, matter_id)
    on delete restrict,
  constraint matter_radar_item_events_dismiss_reason
    check (action <> 'dismiss' or char_length(btrim(coalesce(reason, ''))) between 1 and 500)
);
create index if not exists matter_radar_item_events_fact_idx
  on public.matter_radar_item_events (fact_id, item_type, created_at, id);
create index if not exists matter_radar_item_events_matter_idx
  on public.matter_radar_item_events (matter_id, created_at);

-- Insert-only, and an item moves one way: nothing, then ack, then dismiss or
-- done; dismiss and done close it. The fact row is locked while the event is
-- checked (hence security definer: the backend role may insert, not update,
-- and locking a row takes the update privilege), so two actions at once
-- cannot both pass.
create or replace function public.matter_radar_item_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_radar_item_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  perform 1 from public.matter_profile_facts where id = new.fact_id for update;
  select e.action into latest
    from public.matter_radar_item_events e
    where e.fact_id = new.fact_id and e.item_type = new.item_type
    order by e.created_at desc, e.id desc
    limit 1;
  if not (
    (new.action = 'ack' and latest is null)
    or (new.action in ('dismiss', 'done') and (latest is null or latest = 'ack'))
  ) then
    raise exception 'a % action does not follow %', new.action, coalesce(latest, 'nothing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_radar_item_events_guard() from public, anon, authenticated;

drop trigger if exists matter_radar_item_events_guard_trigger on public.matter_radar_item_events;
create trigger matter_radar_item_events_guard_trigger
  before insert or update or delete on public.matter_radar_item_events
  for each row execute function public.matter_radar_item_events_guard();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter; every write is the
-- backend's (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.matter_radar_item_events enable row level security;

revoke all on public.matter_radar_item_events from public, anon, authenticated;
grant select on public.matter_radar_item_events to authenticated;
grant select, insert on public.matter_radar_item_events to service_role;

drop policy if exists matter_radar_item_events_select_member on public.matter_radar_item_events;
create policy matter_radar_item_events_select_member on public.matter_radar_item_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

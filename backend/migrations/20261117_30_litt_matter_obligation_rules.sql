-- Migration date: 2026-11-17
--
-- Obligation rules of a retainer matter (docs/obligation-rules.md).
--
-- The rules themselves live in CODE (backend/src/modules/radar/radar.rules.*):
-- a versioned catalog, each rule verified by a lawyer against an official
-- source. Nothing about a rule is stored here, and no date is computed here.
-- What is stored is what people decided, as insert-only events:
--
--   matter_obligation_rule_events: a lawyer turned a rule ON ('activate') or
--   OFF ('deactivate') for a matter. A rule is named by (rule_code,
--   rule_version); a new version of a rule starts switched off. A rule is on
--   when its latest event is 'activate'. An activation names the ANCHOR: the
--   confirmed fact of the matter (matter_profile_facts, never deleted) whose
--   date the rule counts from, and how ('direct', or 'first_cycle' when the
--   fact is the date the right was granted). To change the anchor, turn the
--   rule off and on again. Whether a rule may be turned on (it must be
--   verified in the catalog) and whether the fact is confirmed are the
--   backend's checks: the catalog and the fact's decision are not in this
--   table.
--
--   matter_obligation_item_events: what a person did ('ack', 'dismiss',
--   'done') with an item the radar derives from an active rule. The item is
--   named by item_key, `<rule_code>@<version>:<anchor fact id | matter>`; it
--   has no row of its own because items are computed on every read, so there
--   is no fact to point a foreign key at. Same one-way order and the same
--   reason for a dismissal as matter_radar_item_events.
--
-- Actor columns have no foreign key to auth.users, so erasing an account is
-- never blocked by them. No column holds hours. Nothing here computes a date.
--
-- Re-runnable: tables and indexes use if not exists, triggers and policies are
-- dropped before they are created, functions use create or replace, grants are
-- idempotent. (A constraint inside `create table if not exists` is only
-- created with the table.)

create table if not exists public.matter_obligation_rule_events (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete restrict,
  rule_code text not null check (rule_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and char_length(rule_code) <= 80),
  rule_version integer not null check (rule_version >= 1),
  action text not null check (action in ('activate', 'deactivate')),
  anchor_fact_id uuid,
  anchor_mode text check (anchor_mode in ('direct', 'first_cycle')),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint matter_obligation_rule_events_anchor_fk
    foreign key (anchor_fact_id, matter_id) references public.matter_profile_facts(id, matter_id)
    on delete restrict,
  constraint matter_obligation_rule_events_anchor_shape
    check (
      (action = 'activate' and anchor_fact_id is not null and anchor_mode is not null)
      or (action = 'deactivate' and anchor_fact_id is null and anchor_mode is null)
    )
);
create index if not exists matter_obligation_rule_events_matter_idx
  on public.matter_obligation_rule_events (matter_id, rule_code, rule_version, created_at, id);

create table if not exists public.matter_obligation_item_events (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete restrict,
  item_key text not null check (
    char_length(item_key) <= 160
    and item_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+@[0-9]+:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|matter)$'
  ),
  action text not null check (action in ('ack', 'dismiss', 'done')),
  -- The computed date of the item when the person acted; null for an item
  -- that had no date (left for review).
  due_on date,
  reason text check (char_length(reason) <= 500),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint matter_obligation_item_events_dismiss_reason
    check (action <> 'dismiss' or char_length(btrim(coalesce(reason, ''))) between 1 and 500)
);
create index if not exists matter_obligation_item_events_item_idx
  on public.matter_obligation_item_events (matter_id, item_key, created_at, id);

-- ---------------------------------------------------------------------------
-- Insert-only, one way. The matter row is locked while the event is checked
-- (security definer: the backend role may insert, not update, and locking a
-- row takes the update privilege), so two decisions at once cannot both pass.
-- Rules: a rule is activated when it is off (or never was on) and deactivated
-- only when it is on. Items: nothing, then ack, then dismiss or done.
-- ---------------------------------------------------------------------------
create or replace function public.matter_obligation_rule_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_obligation_rule_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  perform 1 from public.matters where id = new.matter_id for update;
  select e.action into latest
    from public.matter_obligation_rule_events e
    where e.matter_id = new.matter_id
      and e.rule_code = new.rule_code
      and e.rule_version = new.rule_version
    order by e.created_at desc, e.id desc
    limit 1;
  if not (
    (new.action = 'activate' and (latest is null or latest = 'deactivate'))
    or (new.action = 'deactivate' and latest is not null and latest = 'activate')
  ) then
    raise exception 'a % action does not follow %', new.action, coalesce(latest, 'nothing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_obligation_rule_events_guard() from public, anon, authenticated;

drop trigger if exists matter_obligation_rule_events_guard_trigger on public.matter_obligation_rule_events;
create trigger matter_obligation_rule_events_guard_trigger
  before insert or update or delete on public.matter_obligation_rule_events
  for each row execute function public.matter_obligation_rule_events_guard();

create or replace function public.matter_obligation_item_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_obligation_item_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  perform 1 from public.matters where id = new.matter_id for update;
  select e.action into latest
    from public.matter_obligation_item_events e
    where e.matter_id = new.matter_id and e.item_key = new.item_key
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
revoke all on function public.matter_obligation_item_events_guard() from public, anon, authenticated;

drop trigger if exists matter_obligation_item_events_guard_trigger on public.matter_obligation_item_events;
create trigger matter_obligation_item_events_guard_trigger
  before insert or update or delete on public.matter_obligation_item_events
  for each row execute function public.matter_obligation_item_events_guard();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter; every write is the
-- backend's (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.matter_obligation_rule_events enable row level security;
alter table public.matter_obligation_item_events enable row level security;

revoke all on public.matter_obligation_rule_events, public.matter_obligation_item_events
  from public, anon, authenticated;
grant select on public.matter_obligation_rule_events, public.matter_obligation_item_events to authenticated;
grant select, insert on public.matter_obligation_rule_events, public.matter_obligation_item_events to service_role;

drop policy if exists matter_obligation_rule_events_select_member on public.matter_obligation_rule_events;
create policy matter_obligation_rule_events_select_member on public.matter_obligation_rule_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists matter_obligation_item_events_select_member on public.matter_obligation_item_events;
create policy matter_obligation_item_events_select_member on public.matter_obligation_item_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

-- Migration date: 2026-11-16
--
-- The client's profile ("ficha") inside a retainer matter: facts captured by a
-- lawyer, each with a citation of an exact passage of a matter document
-- version, and the lawyer's confirmation (docs/client-profile.md).
--
-- 1. matter_profile_facts: one datum (a contract, a date, a power of attorney,
--    an obligation, or something else) and its single source: document,
--    version, the character offsets of the quote in that version's extracted
--    text, the quote itself and the SHA-256 of the whole extracted text it was
--    found in. A fact is never changed or deleted. Whether the source is still
--    the same text is computed when the fact is read (hash and version
--    existence); nothing here watches a document.
-- 2. matter_profile_fact_events: insert-only record of what happened to a fact
--    (created, confirmed, rejected). The latest decision IS the fact's state:
--    no decision means pending. The actor column has no foreign key to
--    auth.users, so erasing an account is never blocked by it.
--
-- The document and version columns carry no foreign key on purpose: a fact
-- outlives a deleted or replaced version and reads as stale.
-- No column holds hours. Dates are stored as entered; computing a deadline is
-- code, never this schema.
--
-- Re-runnable: tables use if not exists, constraints and triggers are dropped
-- before they are created, functions use create or replace.

create table if not exists public.matter_profile_facts (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete restrict,
  kind text not null check (kind in ('contract', 'date', 'power_of_attorney', 'obligation', 'other')),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  -- Fields of the kind, validated by the backend.
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  document_id uuid not null,
  version_id uuid not null,
  start_char integer not null check (start_char >= 0),
  end_char integer not null,
  quote text not null check (char_length(quote) between 1 and 2000),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint matter_profile_facts_span check (end_char > start_char),
  constraint matter_profile_facts_id_matter unique (id, matter_id)
);
create index if not exists matter_profile_facts_matter_idx
  on public.matter_profile_facts (matter_id, kind, created_at desc, id);
create index if not exists matter_profile_facts_version_idx
  on public.matter_profile_facts (version_id);

-- A fact is written once, and only into a private retainer matter (a public
-- matter fails closed).
create or replace function public.matter_profile_facts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_profile_facts is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.matters m
    where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
  ) then
    raise exception 'profile facts belong to a private retainer matter' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_profile_facts_guard() from public, anon, authenticated;

drop trigger if exists matter_profile_facts_guard_trigger on public.matter_profile_facts;
create trigger matter_profile_facts_guard_trigger
  before insert or update or delete on public.matter_profile_facts
  for each row execute function public.matter_profile_facts_guard();

create table if not exists public.matter_profile_fact_events (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null,
  matter_id uuid not null,
  actor_user_id uuid,
  action text not null check (action in ('created', 'confirmed', 'rejected')),
  -- The SHA-256 of the cited version's text the lawyer saw when deciding.
  text_sha256 text check (text_sha256 ~ '^[0-9a-f]{64}$'),
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  constraint matter_profile_fact_events_fact_fk
    foreign key (fact_id, matter_id) references public.matter_profile_facts(id, matter_id)
    on delete restrict,
  constraint matter_profile_fact_events_confirmed_hash check (action <> 'confirmed' or text_sha256 is not null)
);
create index if not exists matter_profile_fact_events_fact_idx
  on public.matter_profile_fact_events (fact_id, created_at, id);
create index if not exists matter_profile_fact_events_matter_idx
  on public.matter_profile_fact_events (matter_id, created_at);

-- Insert-only, and a fact moves one way: (created,) then confirmed or rejected,
-- and a confirmed fact may still be rejected. A lost 'created' row never
-- blocks a decision. The fact row is locked while the
-- event is checked (hence security definer: the backend role may insert, not
-- update, and locking a row takes the update privilege), so two decisions at
-- once cannot both pass.
create or replace function public.matter_profile_fact_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_profile_fact_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  perform 1 from public.matter_profile_facts where id = new.fact_id for update;
  select e.action into latest
    from public.matter_profile_fact_events e
    where e.fact_id = new.fact_id
    order by e.created_at desc, e.id desc
    limit 1;
  if not (
    (new.action = 'created' and latest is null)
    or (new.action = 'confirmed' and (latest is null or latest = 'created'))
    or (new.action = 'rejected' and (latest is null or latest in ('created', 'confirmed')))
  ) then
    raise exception 'a % event does not follow %', new.action, coalesce(latest, 'nothing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_profile_fact_events_guard() from public, anon, authenticated;

drop trigger if exists matter_profile_fact_events_guard_trigger on public.matter_profile_fact_events;
create trigger matter_profile_fact_events_guard_trigger
  before insert or update or delete on public.matter_profile_fact_events
  for each row execute function public.matter_profile_fact_events_guard();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter (an active matter membership
-- plus a current organization membership); every write is the backend's
-- (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.matter_profile_facts enable row level security;
alter table public.matter_profile_fact_events enable row level security;

revoke all on public.matter_profile_facts, public.matter_profile_fact_events
  from public, anon, authenticated;
grant select on public.matter_profile_facts, public.matter_profile_fact_events to authenticated;
grant select, insert on public.matter_profile_facts, public.matter_profile_fact_events to service_role;

drop policy if exists matter_profile_facts_select_member on public.matter_profile_facts;
create policy matter_profile_facts_select_member on public.matter_profile_facts
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists matter_profile_fact_events_select_member on public.matter_profile_fact_events;
create policy matter_profile_fact_events_select_member on public.matter_profile_fact_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

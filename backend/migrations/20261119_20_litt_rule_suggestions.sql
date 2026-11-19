-- Migration date: 2026-11-19
--
-- AI suggestions of WHICH catalog obligation rules apply to a retainer client
-- (docs/obligation-rules.md, "Rule suggestions").
--
-- The model proposes; a lawyer decides. A suggestion points at a rule of the
-- CATALOG (which lives in code and which a lawyer already verified): it never
-- carries a rule text, an operation or a date, and accepting it turns nothing
-- on (turning a rule on is matter_obligation_rule_events, with a confirmed
-- date chosen by the lawyer).
--
--   obligation_rule_suggestions: one row per suggestion, written once and
--   never changed: the rule (code and version), the passage of the document
--   version that suggested it (document, version, offsets, the quote as the
--   document words it, the SHA-256 of the whole text it was found in) and the
--   model's explanation (not verified). There is no status column.
--
--   obligation_rule_suggestion_events: insert-only decisions, 'accepted' or
--   'discarded'. The latest event is the suggestion's state; none means
--   pending. A suggestion is decided once: accepted, or discarded, and an
--   accepted one may still be discarded.
--
-- Whether the quote is in the text, whether the rule is in the catalog and
-- verified and whether it is already on are the backend's checks (the catalog
-- is code). `flow` names the kind of suggestion; only 'catalog_match' exists.
-- The actor columns have no foreign key to auth.users, so erasing an account
-- is never blocked by them; the document and version columns have none either
-- (a suggestion outlives a replaced version and reads as obsolete). No column
-- holds hours or dates of a deadline.
--
-- Re-runnable: tables and indexes use if not exists, triggers and policies
-- are dropped before they are created, functions use create or replace,
-- grants are idempotent.

create table if not exists public.obligation_rule_suggestions (
  id uuid primary key default gen_random_uuid(),
  flow text not null default 'catalog_match' check (flow in ('catalog_match')),
  org_id uuid not null,
  matter_id uuid not null references public.matters(id) on delete restrict,
  project_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  start_char integer not null check (start_char >= 0),
  end_char integer not null,
  quote text not null check (char_length(quote) between 1 and 500),
  page integer check (page >= 1),
  rule_code text not null check (rule_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and char_length(rule_code) <= 80),
  rule_version integer not null check (rule_version >= 1),
  ai_reason text not null check (char_length(ai_reason) between 1 and 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint obligation_rule_suggestions_span check (end_char > start_char),
  constraint obligation_rule_suggestions_id_matter unique (id, matter_id)
);
-- The same rule from the same version of a document is one suggestion, decided
-- or not (also when two runs race).
create unique index if not exists obligation_rule_suggestions_once_idx
  on public.obligation_rule_suggestions (matter_id, rule_code, rule_version, version_id);
create index if not exists obligation_rule_suggestions_matter_idx
  on public.obligation_rule_suggestions (matter_id, created_at desc, id);

-- A suggestion is written once, and only into a private retainer matter (a
-- public matter fails closed).
create or replace function public.obligation_rule_suggestions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'obligation_rule_suggestions is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.matters m
    where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
  ) then
    raise exception 'rule suggestions belong to a private retainer matter' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.obligation_rule_suggestions_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_suggestions_guard_trigger on public.obligation_rule_suggestions;
create trigger obligation_rule_suggestions_guard_trigger
  before insert or update or delete on public.obligation_rule_suggestions
  for each row execute function public.obligation_rule_suggestions_guard();

create table if not exists public.obligation_rule_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null,
  matter_id uuid not null,
  actor_user_id uuid,
  action text not null check (action in ('accepted', 'discarded')),
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  constraint obligation_rule_suggestion_events_suggestion_fk
    foreign key (suggestion_id, matter_id) references public.obligation_rule_suggestions(id, matter_id)
    on delete restrict
);
create index if not exists obligation_rule_suggestion_events_suggestion_idx
  on public.obligation_rule_suggestion_events (suggestion_id, created_at, id);
create index if not exists obligation_rule_suggestion_events_matter_idx
  on public.obligation_rule_suggestion_events (matter_id, created_at);

-- Insert-only and one way: nothing, then accepted or discarded; an accepted
-- suggestion may still be discarded. The suggestion row is locked while the
-- event is checked (security definer: the backend role may insert, not
-- update, and locking a row takes the update privilege), so two decisions at
-- once cannot both pass.
create or replace function public.obligation_rule_suggestion_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'obligation_rule_suggestion_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  perform 1 from public.obligation_rule_suggestions where id = new.suggestion_id for update;
  select e.action into latest
    from public.obligation_rule_suggestion_events e
    where e.suggestion_id = new.suggestion_id
    order by e.created_at desc, e.id desc
    limit 1;
  if not (
    (new.action = 'accepted' and latest is null)
    or (new.action = 'discarded' and (latest is null or latest = 'accepted'))
  ) then
    raise exception 'a % event does not follow %', new.action, coalesce(latest, 'nothing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.obligation_rule_suggestion_events_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_suggestion_events_guard_trigger on public.obligation_rule_suggestion_events;
create trigger obligation_rule_suggestion_events_guard_trigger
  before insert or update or delete on public.obligation_rule_suggestion_events
  for each row execute function public.obligation_rule_suggestion_events_guard();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter; every write is the
-- backend's (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.obligation_rule_suggestions enable row level security;
alter table public.obligation_rule_suggestion_events enable row level security;

revoke all on public.obligation_rule_suggestions, public.obligation_rule_suggestion_events
  from public, anon, authenticated;
grant select on public.obligation_rule_suggestions, public.obligation_rule_suggestion_events to authenticated;
grant select, insert on public.obligation_rule_suggestions, public.obligation_rule_suggestion_events to service_role;

drop policy if exists obligation_rule_suggestions_select_member on public.obligation_rule_suggestions;
create policy obligation_rule_suggestions_select_member on public.obligation_rule_suggestions
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists obligation_rule_suggestion_events_select_member on public.obligation_rule_suggestion_events;
create policy obligation_rule_suggestion_events_select_member on public.obligation_rule_suggestion_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

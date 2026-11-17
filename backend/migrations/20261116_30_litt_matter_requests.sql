-- Migration date: 2026-11-16
--
-- Requests inside a retainer matter (docs/matter-requests.md).
--
-- 1. matters.is_retainer: marks a matter as a retainer. Only a retainer matter
--    takes requests.
-- 2. matter_request_types: the firm's editable catalog of request types.
--    A default type has seed_key and no name (the app words it in the
--    reader's language); renaming it stores a name. A type in use is archived,
--    never deleted.
-- 3. matter_requests: one request of a retainer matter. Never deleted: a
--    request ends as closed or cancelled. `version` is the optimistic
--    concurrency counter of every change.
-- 4. matter_request_rounds: links an existing document version to a request as
--    a negotiation round (number and date). The version belongs to the
--    documents module; nothing here writes a version row.
-- 5. matter_request_events: insert-only record of every change. The actor
--    column has no foreign key to auth.users so erasing an account is never
--    blocked by it (same reason audit_events keeps its user column loose).
--
-- No column holds hours or a time estimate; the round count is the effort
-- measure.
--
-- Re-runnable: columns and tables use if not exists, constraints and triggers
-- are dropped before they are created, functions use create or replace.

alter table public.matters
  add column if not exists is_retainer boolean not null default false;

-- ---------------------------------------------------------------------------
-- The firm's catalog of request types.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_request_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  seed_key text check (
    seed_key in (
      'contracts_clients', 'contracts_suppliers', 'intellectual_property',
      'shareholder_meetings', 'corporate_books', 'other'
    )
  ),
  name text check (char_length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matter_request_types_named check (seed_key is not null or name is not null)
);
create unique index if not exists matter_request_types_seed_once
  on public.matter_request_types (organization_id, seed_key)
  where seed_key is not null;
create unique index if not exists matter_request_types_name_once
  on public.matter_request_types (organization_id, lower(btrim(name)))
  where name is not null and archived_at is null;
create index if not exists matter_request_types_org_idx
  on public.matter_request_types (organization_id, sort_order);

-- ---------------------------------------------------------------------------
-- Requests.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_requests (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete restrict,
  type_id uuid not null references public.matter_request_types(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  complexity text not null check (complexity in ('routine', 'standard', 'complex')),
  status text not null default 'received' check (
    status in ('received', 'in_review', 'with_client', 'with_counterparty', 'closed', 'cancelled')
  ),
  assignee_user_id uuid,
  assignee_level text check (assignee_level in ('apprentice', 'junior', 'senior', 'partner')),
  received_on date not null default current_date,
  closed_on date,
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matter_requests_assignee_level check ((assignee_user_id is null) = (assignee_level is null)),
  constraint matter_requests_closed_on check (
    (status in ('closed', 'cancelled')) = (closed_on is not null)
  ),
  constraint matter_requests_dates check (closed_on is null or closed_on >= received_on),
  constraint matter_requests_id_matter unique (id, matter_id)
);
create index if not exists matter_requests_matter_idx
  on public.matter_requests (matter_id, received_on desc, id);
create index if not exists matter_requests_assignee_idx
  on public.matter_requests (assignee_user_id) where assignee_user_id is not null;

-- A request lives in one matter for good, and only a private retainer matter
-- takes one (a public matter fails closed).
create or replace function public.matter_requests_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.matter_id is distinct from old.matter_id then
    raise exception 'matter_requests.matter_id is never changed' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.matters m
    where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
  ) then
    raise exception 'requests belong to a private retainer matter' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_requests_guard() from public, anon, authenticated;

drop trigger if exists matter_requests_guard_trigger on public.matter_requests;
create trigger matter_requests_guard_trigger
  before insert or update on public.matter_requests
  for each row execute function public.matter_requests_guard();

-- ---------------------------------------------------------------------------
-- Negotiation rounds: an existing document version linked to a request.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_request_rounds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  matter_id uuid not null,
  round_number integer not null check (round_number between 1 and 99),
  round_date date not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id uuid not null references public.document_versions(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint matter_request_rounds_request_fk
    foreign key (request_id, matter_id) references public.matter_requests(id, matter_id)
    on delete restrict,
  constraint matter_request_rounds_version_once unique (request_id, version_id)
);
create index if not exists matter_request_rounds_request_idx
  on public.matter_request_rounds (request_id, round_number, created_at);
create index if not exists matter_request_rounds_version_idx
  on public.matter_request_rounds (version_id);

-- ---------------------------------------------------------------------------
-- Insert-only events.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  matter_id uuid not null,
  actor_user_id uuid,
  action text not null check (
    action in (
      'created', 'edited', 'status_changed', 'assigned', 'unassigned',
      'round_linked', 'round_unlinked'
    )
  ),
  -- Field names, ids, states and numbers only; never the title's text.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint matter_request_events_request_fk
    foreign key (request_id, matter_id) references public.matter_requests(id, matter_id)
    on delete restrict
);
create index if not exists matter_request_events_request_idx
  on public.matter_request_events (request_id, created_at, id);

create or replace function public.matter_request_events_insert_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'matter_request_events is insert-only; % is not allowed', tg_op
    using errcode = '55000';
end;
$$;
revoke all on function public.matter_request_events_insert_only() from public, anon, authenticated;

drop trigger if exists matter_request_events_insert_only_trigger on public.matter_request_events;
create trigger matter_request_events_insert_only_trigger
  before update or delete on public.matter_request_events
  for each row execute function public.matter_request_events_insert_only();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter (an active matter membership
-- plus a current organization membership, so removing someone cuts access in
-- the same request); the catalog is read by the firm's members. Every write is
-- the backend's (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.matter_request_types enable row level security;
alter table public.matter_requests enable row level security;
alter table public.matter_request_rounds enable row level security;
alter table public.matter_request_events enable row level security;

revoke all on public.matter_request_types, public.matter_requests,
  public.matter_request_rounds, public.matter_request_events
  from public, anon, authenticated;
grant select on public.matter_request_types, public.matter_requests,
  public.matter_request_rounds, public.matter_request_events to authenticated;
grant select, insert, update on public.matter_request_types, public.matter_requests to service_role;
grant select, insert, delete on public.matter_request_rounds to service_role;
grant select, insert on public.matter_request_events to service_role;

drop policy if exists matter_request_types_select_member on public.matter_request_types;
create policy matter_request_types_select_member on public.matter_request_types
  for select to authenticated using (public.is_organization_member(organization_id));

drop policy if exists matter_requests_select_member on public.matter_requests;
create policy matter_requests_select_member on public.matter_requests
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists matter_request_rounds_select_member on public.matter_request_rounds;
create policy matter_request_rounds_select_member on public.matter_request_rounds
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists matter_request_events_select_member on public.matter_request_events;
create policy matter_request_events_select_member on public.matter_request_events
  for select to authenticated using (public.matter_role(matter_id) is not null);

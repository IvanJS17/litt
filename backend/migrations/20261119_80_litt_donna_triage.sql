-- Migration date: 2026-11-19
--
-- Donna triage of matter requests (docs/request-triage.md). Every new request
-- of a retainer matter is classified by Jev (type, complexity, urgency,
-- candidate lawyer) and the firm's own AI route drafts an initial strategy,
-- follow-up questions and documents to draft. Everything is a proposal the
-- lawyer accepts, edits or discards.
--
-- 1. projects.donna_enabled: the per-project switch. ON by default, and the
--    column default also turns it ON for every project that already exists
--    (owner decision of 2026-11-19). Only the project owner or a firm admin
--    changes it (backend).
-- 2. matter_request_triage_runs: one row per run (insert-only). Engine,
--    model, tokens, cost, what was read and how much. No document text and
--    no title: counts, ids and hashes only.
-- 3. matter_request_triage_items: what a run proposed (insert-only). The
--    classification is an id or an enumeration; a draft (strategy step,
--    question, document to draft) is the model's own words, never a passage
--    of a document (a citation is a position and a hash).
-- 4. matter_request_triage_decisions: the lawyer's decision on an item
--    (insert-only; the latest one is the state).
-- 5. matter_request_events: the four triage actions join the existing ones.
--
-- Re-runnable: columns and tables use if not exists, constraints are dropped
-- before they are created, triggers and policies are dropped before they are
-- created, functions use create or replace, grants are idempotent.

-- ---------------------------------------------------------------------------
-- 1. The switch.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists donna_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- 5. Events.
-- ---------------------------------------------------------------------------
alter table public.matter_request_events
  drop constraint if exists matter_request_events_action_check;
alter table public.matter_request_events
  add constraint matter_request_events_action_check check (
    action in (
      'created', 'edited', 'status_changed', 'assigned', 'unassigned',
      'round_linked', 'round_unlinked',
      'triage_proposed', 'triage_accepted', 'triage_edited', 'triage_discarded'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Runs.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_request_triage_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null,
  matter_id uuid not null,
  request_id uuid not null,
  -- 'auto' on creating the request, 'manual' on the lawyer's click.
  trigger text not null check (trigger in ('auto', 'manual')),
  started_by uuid,
  -- Classification (Jev).
  classify_status text not null
    check (classify_status in ('ok', 'unavailable', 'invalid')),
  classify_error text,
  jev_model text,
  jev_input_tokens integer check (jev_input_tokens is null or jev_input_tokens >= 0),
  jev_output_tokens integer check (jev_output_tokens is null or jev_output_tokens >= 0),
  -- input_tokens * 0.042 / 1e6 (Jev bills input tokens only).
  jev_cost_usd numeric(12, 8) check (jev_cost_usd is null or jev_cost_usd >= 0),
  -- Generative part (the firm's own AI route).
  generative_status text not null
    check (generative_status in ('ok', 'empty', 'no_key', 'unavailable', 'invalid')),
  generative_provider text,
  generative_model text,
  -- What was sent: a hash, never the text.
  input_sha256 text,
  chars_sent integer not null default 0 check (chars_sent >= 0),
  docs_total integer not null default 0 check (docs_total >= 0),
  docs_read integer not null default 0 check (docs_read >= 0),
  docs_partial integer not null default 0 check (docs_partial >= 0),
  read_version_ids uuid[] not null default '{}',
  unread_version_ids uuid[] not null default '{}',
  quotes_rejected integer not null default 0 check (quotes_rejected >= 0),
  schema_failures integer not null default 0 check (schema_failures >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  constraint matter_request_triage_runs_request_fk
    foreign key (request_id, matter_id) references public.matter_requests(id, matter_id)
    on delete restrict,
  constraint matter_request_triage_runs_id_request_key unique (id, request_id)
);
create index if not exists matter_request_triage_runs_request_idx
  on public.matter_request_triage_runs (request_id, created_at, id);
create index if not exists matter_request_triage_runs_org_month_idx
  on public.matter_request_triage_runs (org_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Items.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_request_triage_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  request_id uuid not null,
  matter_id uuid not null,
  org_id uuid not null,
  kind text not null check (
    kind in ('type', 'complexity', 'urgency', 'candidate', 'strategy', 'question', 'document')
  ),
  position integer not null default 0 check (position >= 0),
  -- Classification: exactly the column of its kind.
  value_type_id uuid,
  value_enum text,
  value_user_id uuid,
  -- Jev's confidence (0..1) and whether it is below the line the card trusts.
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  low_confidence boolean not null default false,
  -- Urgency raised by an alarm word of the fixed list.
  forced_by_alarm boolean not null default false,
  -- A draft is the model's own words (never a passage of a document).
  draft_text text check (draft_text is null or char_length(draft_text) <= 400),
  draft_purpose text check (draft_purpose is null or char_length(draft_purpose) <= 400),
  playbook_id uuid,
  -- A citation: where in which version, and the hash of that version's text.
  version_id uuid,
  start_char integer check (start_char is null or start_char >= 0),
  end_char integer check (end_char is null or end_char >= 0),
  text_sha256 text,
  created_at timestamptz not null default now(),
  constraint matter_request_triage_items_run_fk
    foreign key (run_id, request_id) references public.matter_request_triage_runs(id, request_id)
    on delete restrict,
  constraint matter_request_triage_items_id_request_key unique (id, request_id),
  constraint matter_request_triage_items_shape check (
    case kind
      when 'type' then value_type_id is not null and value_enum is null and value_user_id is null and draft_text is null
      when 'complexity' then value_enum in ('routine', 'standard', 'complex') and value_type_id is null and value_user_id is null and draft_text is null
      when 'urgency' then value_enum in ('low', 'normal', 'urgent') and value_type_id is null and value_user_id is null and draft_text is null
      when 'candidate' then value_user_id is not null and value_type_id is null and value_enum is null and draft_text is null
      else draft_text is not null and value_type_id is null and value_enum is null and value_user_id is null
    end
  )
);
create index if not exists matter_request_triage_items_run_idx
  on public.matter_request_triage_items (run_id, kind, position, id);
create index if not exists matter_request_triage_items_request_idx
  on public.matter_request_triage_items (request_id, created_at, id);

-- ---------------------------------------------------------------------------
-- 4. Decisions.
-- ---------------------------------------------------------------------------
create table if not exists public.matter_request_triage_decisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  request_id uuid not null,
  matter_id uuid not null,
  org_id uuid not null,
  -- No foreign key to auth.users: erasing an account is never blocked.
  actor_user_id uuid,
  action text not null check (action in ('accepted', 'edited', 'discarded')),
  -- What the lawyer chose when editing a classification, or wrote when
  -- editing a draft. Absent for accepted and discarded.
  edited_type_id uuid,
  edited_enum text,
  edited_user_id uuid,
  edited_text text check (edited_text is null or char_length(edited_text) <= 400),
  edited_purpose text check (edited_purpose is null or char_length(edited_purpose) <= 400),
  created_at timestamptz not null default now(),
  constraint matter_request_triage_decisions_item_fk
    foreign key (item_id, request_id) references public.matter_request_triage_items(id, request_id)
    on delete restrict
);
create index if not exists matter_request_triage_decisions_request_idx
  on public.matter_request_triage_decisions (request_id, created_at, id);
create index if not exists matter_request_triage_decisions_item_idx
  on public.matter_request_triage_decisions (item_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Insert-only: no update, no delete, no truncate, on the three tables.
-- ---------------------------------------------------------------------------
create or replace function public.matter_request_triage_insert_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is insert-only; % is not allowed', tg_table_name, tg_op
    using errcode = '55000';
end;
$$;
revoke all on function public.matter_request_triage_insert_only() from public, anon, authenticated;

drop trigger if exists matter_request_triage_runs_insert_only_trigger on public.matter_request_triage_runs;
create trigger matter_request_triage_runs_insert_only_trigger
  before update or delete on public.matter_request_triage_runs
  for each row execute function public.matter_request_triage_insert_only();
drop trigger if exists matter_request_triage_runs_no_truncate_trigger on public.matter_request_triage_runs;
create trigger matter_request_triage_runs_no_truncate_trigger
  before truncate on public.matter_request_triage_runs
  for each statement execute function public.matter_request_triage_insert_only();

drop trigger if exists matter_request_triage_items_insert_only_trigger on public.matter_request_triage_items;
create trigger matter_request_triage_items_insert_only_trigger
  before update or delete on public.matter_request_triage_items
  for each row execute function public.matter_request_triage_insert_only();
drop trigger if exists matter_request_triage_items_no_truncate_trigger on public.matter_request_triage_items;
create trigger matter_request_triage_items_no_truncate_trigger
  before truncate on public.matter_request_triage_items
  for each statement execute function public.matter_request_triage_insert_only();

drop trigger if exists matter_request_triage_decisions_insert_only_trigger on public.matter_request_triage_decisions;
create trigger matter_request_triage_decisions_insert_only_trigger
  before update or delete on public.matter_request_triage_decisions
  for each row execute function public.matter_request_triage_insert_only();
drop trigger if exists matter_request_triage_decisions_no_truncate_trigger on public.matter_request_triage_decisions;
create trigger matter_request_triage_decisions_no_truncate_trigger
  before truncate on public.matter_request_triage_decisions
  for each statement execute function public.matter_request_triage_insert_only();

-- ---------------------------------------------------------------------------
-- RLS: read by the people who can open the matter (the runs, items and
-- decisions hold no document text). Every write is the backend's
-- (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.matter_request_triage_runs enable row level security;
alter table public.matter_request_triage_items enable row level security;
alter table public.matter_request_triage_decisions enable row level security;

revoke all on public.matter_request_triage_runs, public.matter_request_triage_items,
  public.matter_request_triage_decisions from public, anon, authenticated;
grant select on public.matter_request_triage_runs, public.matter_request_triage_items,
  public.matter_request_triage_decisions to authenticated;
grant select, insert on public.matter_request_triage_runs, public.matter_request_triage_items,
  public.matter_request_triage_decisions to service_role;

drop policy if exists matter_request_triage_runs_select_member on public.matter_request_triage_runs;
create policy matter_request_triage_runs_select_member on public.matter_request_triage_runs
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists matter_request_triage_items_select_member on public.matter_request_triage_items;
create policy matter_request_triage_items_select_member on public.matter_request_triage_items
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists matter_request_triage_decisions_select_member on public.matter_request_triage_decisions;
create policy matter_request_triage_decisions_select_member on public.matter_request_triage_decisions
  for select to authenticated using (public.matter_role(matter_id) is not null);

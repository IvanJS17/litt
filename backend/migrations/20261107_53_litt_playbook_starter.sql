-- Migration date: 2026-11-07
--
-- LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Draft
-- and ready" and "Models").
--
-- public.playbooks:
--   status                   'draft' or 'ready'. A draft cannot be used in a
--                            review until an editor marks it ready. Existing
--                            playbooks (imported or written by hand) are
--                            'ready', as before.
--   is_model                 offered as a starting point in its workspace;
--                            only a ready playbook can be a model.
--   derived_from_playbook_id the playbook a copy started from; the copy is
--                            independent, so deleting the original only
--                            clears this column.
--   intake_json              the questionnaire answers a draft was written
--                            from. Kept out of content_json, which every
--                            review snapshots and sends to the model.
--
-- public.playbook_imports:
--   kind                     'import' (a file), 'draft' (a questionnaire) or
--                            'proposal' (changes proposed for a copy). The
--                            same row lifecycle, jobs and heartbeat apply.
--   request_json             what a draft or proposal was asked with, until
--                            its job ends; never in db_jobs.payload.
--
-- public.playbook_changes: the changes proposed for a copy, each accepted or
-- rejected one by one. Rows go with their playbook (cascade); RLS is on and
-- there are no policies or browser grants, like the other playbook tables.
--
-- No rows are inserted: the playbook catalogue ships empty.
--
-- Safe to re-run: add column if not exists, drop-before-create for
-- constraints, create ... if not exists.

alter table public.playbooks add column if not exists status text not null default 'ready';
alter table public.playbooks add column if not exists is_model boolean not null default false;
alter table public.playbooks add column if not exists derived_from_playbook_id uuid
  references public.playbooks(id) on delete set null;
alter table public.playbooks add column if not exists intake_json jsonb;
alter table public.playbooks drop constraint if exists playbooks_status_check;
alter table public.playbooks add constraint playbooks_status_check
  check (status in ('draft', 'ready'));
alter table public.playbooks drop constraint if exists playbooks_model_ready_check;
alter table public.playbooks add constraint playbooks_model_ready_check
  check (not is_model or status = 'ready');
create index if not exists idx_playbooks_org_model
  on public.playbooks(org_id, updated_at desc) where is_model;
create index if not exists idx_playbooks_derived_from
  on public.playbooks(derived_from_playbook_id) where derived_from_playbook_id is not null;

alter table public.playbook_imports add column if not exists kind text not null default 'import';
alter table public.playbook_imports add column if not exists request_json jsonb;
alter table public.playbook_imports drop constraint if exists playbook_imports_kind_check;
alter table public.playbook_imports add constraint playbook_imports_kind_check
  check (kind in ('import', 'draft', 'proposal'));

create table if not exists public.playbook_changes (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  import_id uuid references public.playbook_imports(id) on delete set null,
  source text not null default 'starting_point',
  op text not null,
  -- The rule's id in content_json; topic_id is where add_rule puts it (null:
  -- no topic).
  rule_id text not null,
  topic_id text,
  before_json jsonb,
  after_json jsonb,
  changed_fields text[] not null default '{}',
  rationale text not null default '',
  status text not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint playbook_changes_source_check check (source in ('starting_point')),
  constraint playbook_changes_op_check
    check (op in ('add_rule', 'modify_rule', 'remove_rule')),
  constraint playbook_changes_status_check
    check (status in ('pending', 'accepted', 'rejected')),
  constraint playbook_changes_decision_check
    check ((status = 'pending') = (decided_at is null))
);
create index if not exists idx_playbook_changes_playbook_status
  on public.playbook_changes(playbook_id, status, created_at);
create index if not exists idx_playbook_changes_import
  on public.playbook_changes(import_id) where import_id is not null;
create index if not exists idx_playbook_changes_decided_by
  on public.playbook_changes(decided_by) where decided_by is not null;
alter table public.playbook_changes enable row level security;
revoke all on public.playbook_changes from anon, authenticated;
-- A fresh install grants this through schema.sql's grant on all tables; a
-- table created after that ran needs its own.
grant select, insert, update, delete on public.playbook_changes to service_role;

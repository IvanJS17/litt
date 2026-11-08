-- Migration date: 2026-11-08
--
-- LiTT training layer 3, bulk review designer (docs/training.md): the junior
-- designs a tabular review's questions and audits by hand a sample of its
-- cells; the current mentor evaluates both.
--
-- training_review_audits is learning data, like every training_* table: it
-- hangs off the person's org_members row (cascade), RLS is on and only
-- service_role has privileges. Rules the table keeps by itself:
--
--   * The sample holds identifiers and marks only. The content of a cell
--     never reaches the row: each item may carry just row_id, column_index,
--     digest (a short hash that tells whether the cell changed afterwards),
--     mark, note, mentor_mark. training_review_audit_sample_ok() enforces
--     the keys, the marks and the size.
--   * A review has at most one audit that is not stale per person; a
--     regenerated review leaves the old one stale and a new one is drawn.
--   * The mentor's evaluation (outcome, note up to 500 characters) is set
--     together and only on a complete audit.
--
-- Safe to re-run: if not exists, create or replace, drop-before-create.

create or replace function public.training_review_audit_sample_ok(p_sample jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_sample) = 'array'
    and pg_catalog.jsonb_array_length(p_sample) between 1 and 20
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_sample) as e(item)
      where pg_catalog.jsonb_typeof(e.item) <> 'object'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(e.item) as k(key)
          where k.key not in ('row_id', 'column_index', 'digest', 'mark', 'note', 'mentor_mark')
        )
        or pg_catalog.jsonb_typeof(e.item -> 'row_id') is distinct from 'string'
        or pg_catalog.jsonb_typeof(e.item -> 'column_index') is distinct from 'number'
        or pg_catalog.jsonb_typeof(e.item -> 'digest') is distinct from 'string'
        or (e.item ? 'mark' and (e.item ->> 'mark') not in ('correct', 'incomplete', 'incorrect'))
        or (e.item ? 'mentor_mark' and (e.item ->> 'mentor_mark') not in ('correct', 'incomplete', 'incorrect'))
        or (e.item ? 'note' and (
          pg_catalog.jsonb_typeof(e.item -> 'note') <> 'string'
          or pg_catalog.char_length(e.item ->> 'note') > 500
        ))
    );
$$;
revoke all on function public.training_review_audit_sample_ok(jsonb) from public, anon, authenticated;
grant execute on function public.training_review_audit_sample_ok(jsonb) to service_role;

create table if not exists public.training_review_audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  tabular_review_id uuid not null references public.tabular_reviews(id) on delete cascade,
  -- Names and instructions of the columns when the audit started.
  columns_snapshot jsonb not null,
  -- The code-only review of the questions (lintColumns): warnings, no model.
  lint jsonb not null default '[]'::jsonb,
  -- The seed the server drew the sample with; the same seed gives the same sample.
  seed text not null,
  sample jsonb not null,
  status text not null default 'open',
  completed_at timestamptz,
  mentor_outcome text,
  mentor_note text,
  evaluated_at timestamptz,
  evaluated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_review_audits_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  constraint training_review_audits_status_check check (
    status in ('open', 'complete', 'stale')
    and (status <> 'open' or completed_at is null)
    and (status <> 'complete' or completed_at is not null)
  ),
  constraint training_review_audits_snapshot_check check (
    jsonb_typeof(columns_snapshot) = 'array'
    and jsonb_typeof(lint) = 'array'
    and char_length(seed) between 1 and 100
  ),
  constraint training_review_audits_sample_check check (
    public.training_review_audit_sample_ok(sample)
  ),
  constraint training_review_audits_evaluation_check check (
    (mentor_outcome is null or mentor_outcome in ('adequate', 'needs_work'))
    and (mentor_outcome is null) = (evaluated_at is null)
    and (mentor_note is null or (mentor_outcome is not null and char_length(mentor_note) <= 500))
    -- evaluated_by goes to null with that account, never set without an outcome.
    and (evaluated_by is null or mentor_outcome is not null)
  )
);

-- One live audit per person and review; stale ones pile up as history.
create unique index if not exists training_review_audits_live_idx
  on public.training_review_audits(org_id, trainee_user_id, tabular_review_id)
  where status <> 'stale';
create index if not exists training_review_audits_review_idx
  on public.training_review_audits(tabular_review_id);
create index if not exists training_review_audits_evaluated_by_idx
  on public.training_review_audits(evaluated_by);

alter table public.training_review_audits enable row level security;
revoke all on public.training_review_audits from anon, authenticated;
grant select, insert, update, delete on public.training_review_audits to service_role;

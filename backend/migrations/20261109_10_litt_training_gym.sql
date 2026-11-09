-- Migration date: 2026-11-09
--
-- LiTT training layer 4, the gym (docs/training.md): a mentor writes a
-- fictitious case with seeded errors; the pupil gets an attempt, a timed
-- review of numbered paragraphs, and marks the paragraphs they think have an
-- error. Scoring is by paragraph number only; no text is interpreted.
--
-- training_gym_cases is the mentor's own content: created_by is nulled when
-- the account is erased. training_gym_attempts is learning data, like every
-- training_* table: it hangs from the person's membership (deleted with it),
-- RLS is on and nothing is granted to the browser roles; the backend
-- (service_role) reads it for the person and their CURRENT mentor only
-- (training_can_read_learning).
--
--   - An attempt keeps a copy of the case, so editing or deleting the case
--     does not change the history.
--   - Statuses: assigned, in_progress (started: the server fixed
--     deadline_at) and submitted (by the pupil, or by the deadline).
--   - One attempt is not yet submitted per case and pupil.
--   - The shape of errors and findings is checked by the server.

create table if not exists public.training_gym_cases (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  practice text not null,
  title text not null,
  paragraphs text[] not null,
  -- [{ paragraph, kind, explanation, hint? }], one error per paragraph.
  errors jsonb not null default '[]',
  time_limit_minutes int not null,
  fictitious boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_gym_cases_practice_check check (
    practice = lower(btrim(practice)) and practice <> '' and char_length(practice) <= 200
  ),
  constraint training_gym_cases_time_check check (time_limit_minutes between 1 and 240),
  constraint training_gym_cases_fictitious_check check (fictitious)
);
create index if not exists training_gym_cases_author_idx
  on public.training_gym_cases(org_id, created_by, created_at);

create table if not exists public.training_gym_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  case_id uuid references public.training_gym_cases(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  -- The copy of the case.
  title text not null,
  practice text not null,
  paragraphs text[] not null,
  errors jsonb not null default '[]',
  time_limit_minutes int not null,
  status text not null default 'assigned',
  started_at timestamptz,
  deadline_at timestamptz,
  submitted_at timestamptz,
  -- [{ paragraph, kind, note }], replaced as a whole.
  findings jsonb not null default '[]',
  -- Indexes (in errors) of the hints the pupil asked for, in order.
  hints_used int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.training_gym_attempts drop constraint if exists training_gym_attempts_member_fkey;
alter table public.training_gym_attempts add constraint training_gym_attempts_member_fkey
  foreign key (org_id, trainee_user_id)
  references public.org_members(org_id, user_id) on delete cascade;

alter table public.training_gym_attempts drop constraint if exists training_gym_attempts_status_check;
alter table public.training_gym_attempts add constraint training_gym_attempts_status_check
  check (
    status in ('assigned', 'in_progress', 'submitted')
    and time_limit_minutes between 1 and 240
    and (status = 'assigned') = (started_at is null)
    and (status = 'assigned') = (deadline_at is null)
    and (status = 'submitted') = (submitted_at is not null)
  );

create index if not exists training_gym_attempts_trainee_idx
  on public.training_gym_attempts(org_id, trainee_user_id, created_at);
-- One attempt that is not yet submitted per case and pupil.
create unique index if not exists training_gym_attempts_open_key
  on public.training_gym_attempts(case_id, trainee_user_id)
  where status <> 'submitted' and case_id is not null;

alter table public.training_gym_cases enable row level security;
alter table public.training_gym_attempts enable row level security;
revoke all on public.training_gym_cases from anon, authenticated;
revoke all on public.training_gym_attempts from anon, authenticated;
grant select, insert, update, delete on public.training_gym_cases to service_role;
grant select, insert, update, delete on public.training_gym_attempts to service_role;

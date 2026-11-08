-- Migration date: 2026-11-08
--
-- LiTT training layer 3, own map and retake (docs/training.md). The map and
-- the calibration are computed on read from the turn notes, so only the
-- retake needs a table: one question about a topic the person is weak at,
-- built from what they themselves wrote, their answer, and the contrast of
-- the two.
--
-- training_retakes is learning data, like every training_* table: it hangs
-- from the person's membership (deleted with it), RLS is on and nothing is
-- granted to the browser roles; the backend (service_role) reads it for the
-- person and their CURRENT mentor only (training_can_read_learning).
--
--   - Statuses: pending (the model is working: the question is being made
--     or the answer judged), open (a question waits for the answer),
--     answered (done) and failed (the question could not be made).
--   - The answer is written once, with its contrast and verdict, and then it
--     can no longer change.
--   - The route (provider, model, credential reference; identifiers only) is
--     the PERSON's own, fixed on the row when the question is made.
--   - One retake is pending or open at a time per person and organization.
--   - No practice area, no matter and no document are kept: a retake is
--     about a topic, and its text is generalized by the prompt.

create table if not exists public.training_retakes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The topic as the map keys it (lower case, no accents) and as it reads.
  topic_key text not null,
  topic_label text not null,
  status text not null default 'pending',
  question text,
  answer text,
  contrast text,
  verdict text,
  model_provider text,
  model text,
  credential_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  answered_at timestamptz
);

alter table public.training_retakes drop constraint if exists training_retakes_member_fkey;
alter table public.training_retakes add constraint training_retakes_member_fkey
  foreign key (org_id, trainee_user_id)
  references public.org_members(org_id, user_id) on delete cascade;

alter table public.training_retakes drop constraint if exists training_retakes_status_check;
alter table public.training_retakes add constraint training_retakes_status_check
  check (status in ('pending', 'open', 'answered', 'failed'));

alter table public.training_retakes drop constraint if exists training_retakes_topic_check;
alter table public.training_retakes add constraint training_retakes_topic_check
  check (
    char_length(topic_key) between 1 and 80
    and char_length(topic_label) between 1 and 80
  );

alter table public.training_retakes drop constraint if exists training_retakes_question_check;
alter table public.training_retakes add constraint training_retakes_question_check
  check (
    (question is null or char_length(question) between 1 and 600)
    and (status not in ('open', 'answered') or question is not null)
  );

alter table public.training_retakes drop constraint if exists training_retakes_answer_check;
alter table public.training_retakes add constraint training_retakes_answer_check
  check (
    (status = 'answered') = (answer is not null)
    and (answer is null) = (answered_at is null)
    and (answer is null or char_length(answer) between 60 and 4000)
    and (status = 'answered') = (contrast is not null)
    and (status = 'answered') = (verdict is not null)
    and (contrast is null or char_length(contrast) <= 8000)
    and (verdict is null or verdict in ('coincide', 'parcial', 'no_coincide'))
  );

alter table public.training_retakes drop constraint if exists training_retakes_route_check;
alter table public.training_retakes add constraint training_retakes_route_check
  check (
    num_nonnulls(model_provider, model, credential_ref) in (0, 3)
    and (status not in ('open', 'answered') or model_provider is not null)
  );

create index if not exists training_retakes_trainee_idx
  on public.training_retakes(org_id, trainee_user_id, created_at);
-- A person has one retake pending or open at a time in each organization.
create unique index if not exists training_retakes_open_key
  on public.training_retakes(org_id, trainee_user_id) where status in ('pending', 'open');

-- What the person answered is written once: the contrast and the verdict
-- come with it and cannot be matched to a rewritten answer.
create or replace function public.training_retakes_answer_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.answer is not null and (new.answer is distinct from old.answer
      or new.contrast is distinct from old.contrast
      or new.verdict is distinct from old.verdict) then
    raise exception 'A training retake''s answer is recorded once'
      using errcode = 'LT002';
  end if;
  return new;
end;
$$;
revoke all on function public.training_retakes_answer_once() from public, anon, authenticated;

drop trigger if exists training_retakes_answer_once on public.training_retakes;
create trigger training_retakes_answer_once
  before update on public.training_retakes
  for each row execute function public.training_retakes_answer_once();

alter table public.training_retakes enable row level security;
revoke all on public.training_retakes from anon, authenticated;
grant select, insert, update, delete on public.training_retakes to service_role;

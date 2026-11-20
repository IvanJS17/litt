-- Migration date: 2026-11-19
--
-- Donna S8c: "Sugerir reglas" reads ALL the documents of a retainer client and
-- asks the lawyer closed yes/no questions for the rules the documents do not
-- resolve (docs/obligation-rules.md, "Rule suggestions: all documents and
-- questions"). Extends the S8a/S8b tables; nothing existing is rewritten.
--
--   obligation_rule_questions: one row per catalog rule the AI said needs a
--   yes/no question because its applicability depends on a fact that is NOT in
--   the documents. It stores the RULE only: the text of the question is built
--   by the code from the catalog (legal's own "aplica cuando"), never from the
--   model. Written once, never changed. One per rule (code and version) and
--   matter, answered or not.
--
--   obligation_rule_question_answers: the lawyer's answer, 'yes' or 'no',
--   insert-only, one per question. THE ANSWER IS NEVER SENT TO ANY MODEL.
--
--   obligation_rule_suggestions: `flow` gains 'lawyer_answer' (a 'yes' answer:
--   the evidence is the lawyer's own answer, so it has no document, no
--   version, no quote and no model words; it points at its question and its
--   creator is the lawyer who answered). `run_id` groups the
--   suggestions of one multi-document read so that a better citation of the
--   same rule found in a later call can replace an earlier one (the earlier
--   one gets a 'discarded' event with no actor; nothing is updated).
--   Existing rows (flow 'catalog_match' and 'new_rule_draft') keep their
--   shape: the flow-shape check below still demands their document columns.
--
-- No column holds a date or hours of a deadline. The actor columns have no
-- foreign key to auth.users (erasing an account is never blocked).
--
-- Re-runnable: tables and indexes use if not exists, constraints, triggers and
-- policies are dropped before they are created, functions use create or
-- replace, grants are idempotent.

-- ---------------------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------------------
create table if not exists public.obligation_rule_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  matter_id uuid not null references public.matters(id) on delete restrict,
  project_id uuid not null,
  rule_code text not null check (rule_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and char_length(rule_code) <= 80),
  rule_version integer not null check (rule_version >= 1),
  run_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint obligation_rule_questions_id_matter unique (id, matter_id)
);
create unique index if not exists obligation_rule_questions_once_idx
  on public.obligation_rule_questions (matter_id, rule_code, rule_version);
create index if not exists obligation_rule_questions_matter_idx
  on public.obligation_rule_questions (matter_id, created_at desc, id);

create or replace function public.obligation_rule_questions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'obligation_rule_questions is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.matters m
    where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
  ) then
    raise exception 'rule questions belong to a private retainer matter' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.obligation_rule_questions_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_questions_guard_trigger on public.obligation_rule_questions;
create trigger obligation_rule_questions_guard_trigger
  before insert or update or delete on public.obligation_rule_questions
  for each row execute function public.obligation_rule_questions_guard();

create table if not exists public.obligation_rule_question_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  matter_id uuid not null,
  actor_user_id uuid,
  answer text not null check (answer in ('yes', 'no')),
  created_at timestamptz not null default now(),
  constraint obligation_rule_question_answers_question_fk
    foreign key (question_id, matter_id) references public.obligation_rule_questions(id, matter_id)
    on delete restrict
);
-- A question is answered once.
create unique index if not exists obligation_rule_question_answers_once_idx
  on public.obligation_rule_question_answers (question_id);
create index if not exists obligation_rule_question_answers_matter_idx
  on public.obligation_rule_question_answers (matter_id, created_at);

create or replace function public.obligation_rule_question_answers_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'obligation_rule_question_answers is insert-only; % is not allowed', tg_op
    using errcode = '55000';
end;
$$;
revoke all on function public.obligation_rule_question_answers_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_question_answers_guard_trigger on public.obligation_rule_question_answers;
create trigger obligation_rule_question_answers_guard_trigger
  before update or delete on public.obligation_rule_question_answers
  for each row execute function public.obligation_rule_question_answers_guard();

-- ---------------------------------------------------------------------------
-- Suggestions: the 'lawyer_answer' flow
-- ---------------------------------------------------------------------------
alter table public.obligation_rule_suggestions drop constraint if exists obligation_rule_suggestions_flow_check;
alter table public.obligation_rule_suggestions
  add constraint obligation_rule_suggestions_flow_check
  check (flow in ('catalog_match', 'new_rule_draft', 'lawyer_answer'));

alter table public.obligation_rule_suggestions alter column document_id drop not null;
alter table public.obligation_rule_suggestions alter column version_id drop not null;
alter table public.obligation_rule_suggestions alter column text_sha256 drop not null;
alter table public.obligation_rule_suggestions alter column start_char drop not null;
alter table public.obligation_rule_suggestions alter column end_char drop not null;
alter table public.obligation_rule_suggestions alter column quote drop not null;
alter table public.obligation_rule_suggestions add column if not exists run_id uuid;
alter table public.obligation_rule_suggestions add column if not exists question_id uuid;

alter table public.obligation_rule_suggestions drop constraint if exists obligation_rule_suggestions_question_fk;
alter table public.obligation_rule_suggestions
  add constraint obligation_rule_suggestions_question_fk
  foreign key (question_id, matter_id) references public.obligation_rule_questions(id, matter_id)
  on delete restrict;

alter table public.obligation_rule_suggestions drop constraint if exists obligation_rule_suggestions_flow_shape;
alter table public.obligation_rule_suggestions
  add constraint obligation_rule_suggestions_flow_shape check (
    (flow = 'catalog_match'
      and matter_id is not null and rule_code is not null and rule_version is not null
      and ai_reason is not null and draft is null and ai_provider is null and ai_model is null
      and question_id is null
      and document_id is not null and version_id is not null and text_sha256 is not null
      and start_char is not null and end_char is not null and quote is not null)
    or
    (flow = 'new_rule_draft'
      and matter_id is null and rule_code is null and rule_version is null
      and ai_reason is null and draft is not null
      and ai_provider is not null and char_length(ai_provider) between 1 and 80
      and ai_model is not null and char_length(ai_model) between 1 and 200
      and question_id is null
      and document_id is not null and version_id is not null and text_sha256 is not null
      and start_char is not null and end_char is not null and quote is not null)
    or
    -- The evidence is the lawyer's answer: no document, no passage, no model words.
    (flow = 'lawyer_answer'
      and matter_id is not null and rule_code is not null and rule_version is not null
      and ai_reason is null and draft is null and ai_provider is null and ai_model is null
      and question_id is not null
      and document_id is null and version_id is null and text_sha256 is null
      and start_char is null and end_char is null and quote is null and page is null)
  );

-- A 'yes' answer is one suggestion.
create unique index if not exists obligation_rule_suggestions_question_once_idx
  on public.obligation_rule_suggestions (question_id) where question_id is not null;
create index if not exists obligation_rule_suggestions_run_idx
  on public.obligation_rule_suggestions (matter_id, run_id) where run_id is not null;

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
  if new.flow in ('catalog_match', 'lawyer_answer') then
    if not exists (
      select 1 from public.matters m
      where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
    ) then
      raise exception 'rule suggestions belong to a private retainer matter' using errcode = '23514';
    end if;
  else
    if not exists (
      select 1 from public.projects p
      where p.id = new.project_id and p.org_id is not null and p.org_id = new.org_id
    ) or exists (
      select 1 from public.matters m where m.project_id = new.project_id
    ) then
      raise exception 'rule proposals belong to a firm project that is not a matter' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.obligation_rule_suggestions_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_suggestions_guard_trigger on public.obligation_rule_suggestions;
create trigger obligation_rule_suggestions_guard_trigger
  before insert or update or delete on public.obligation_rule_suggestions
  for each row execute function public.obligation_rule_suggestions_guard();

-- Events: a 'lawyer_answer' suggestion follows the same one-way path as a
-- catalog match (nothing, then accepted or discarded; accepted may still be
-- discarded).
create or replace function public.obligation_rule_suggestion_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent record;
  latest text;
  allowed boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'obligation_rule_suggestion_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  select s.flow, s.matter_id into parent
    from public.obligation_rule_suggestions s where s.id = new.suggestion_id for update;
  if not found then
    -- No such suggestion: the foreign key says so.
    return new;
  end if;
  if new.matter_id is distinct from parent.matter_id then
    raise exception 'the event names another matter than its suggestion' using errcode = '23514';
  end if;
  select e.action into latest
    from public.obligation_rule_suggestion_events e
    where e.suggestion_id = new.suggestion_id
    order by e.created_at desc, e.id desc
    limit 1;
  if parent.flow in ('catalog_match', 'lawyer_answer') then
    allowed := (new.action = 'accepted' and latest is null)
      or (new.action = 'discarded' and (latest is null or latest = 'accepted'));
  else
    allowed := (new.action = 'sent_to_legal' and latest is null)
      or (new.action = 'discarded' and (latest is null or latest = 'sent_to_legal'))
      or (new.action = 'implemented' and latest is not null and latest = 'sent_to_legal');
  end if;
  if not coalesce(allowed, false) then
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
alter table public.obligation_rule_questions enable row level security;
alter table public.obligation_rule_question_answers enable row level security;

revoke all on public.obligation_rule_questions, public.obligation_rule_question_answers
  from public, anon, authenticated;
grant select on public.obligation_rule_questions, public.obligation_rule_question_answers to authenticated;
grant select, insert on public.obligation_rule_questions, public.obligation_rule_question_answers to service_role;

drop policy if exists obligation_rule_questions_select_member on public.obligation_rule_questions;
create policy obligation_rule_questions_select_member on public.obligation_rule_questions
  for select to authenticated using (public.matter_role(matter_id) is not null);

drop policy if exists obligation_rule_question_answers_select_member on public.obligation_rule_question_answers;
create policy obligation_rule_question_answers_select_member on public.obligation_rule_question_answers
  for select to authenticated using (public.matter_role(matter_id) is not null);

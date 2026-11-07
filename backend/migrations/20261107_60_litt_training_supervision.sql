-- Migration date: 2026-11-07
--
-- LiTT training, layer 2 «Supervisión» (docs/training.md): the data behind
-- a mentor's supervision of a pupil.
--
--   training_work_reviews    the two-minute review of one piece of work (one
--                            chat with turn notes): what the pupil proposed,
--                            what the AI corrected, where they doubted and
--                            what was left unverified.
--   training_defenses        an oral defense: five questions (one a change of
--                            facts) and its outcome, recorded once.
--   training_urgency_passes  a mentor's time-limited pass, for one matter,
--                            that lifts «Tu turno primero» (the output lock
--                            stays).
--
-- They are learning data. One rule decides who reads them:
-- training_can_read_learning(actor, org, trainee) is true for the person
-- themselves and for their CURRENT mentor (training_pupils), both still
-- members of the organization; nobody else: not an owner, not an admin, not
-- a previous mentor. The backend checks it before every read and write; RLS
-- is on with no policies or browser grants, like the layer-1 tables.
--
-- Every row hangs off the pupil's org_members row, so it is deleted when
-- they leave the organization or their account is erased (owner decision
-- 2026-10-24); prepare_account_org_departures is not changed. Releasing a
-- pupil ends their urgency passes (they hang off training_pupils) and keeps
-- their reviews and defenses, like the turn notes. The ids of the people who
-- acted (generated_by, reviewed_by, recorded_by, granted_by, revoked_by) are
-- set to null when those accounts go. Audit events about these rows stay
-- (insert-only).
--
-- Safe to re-run: if not exists, create or replace, drop-before-create.

create table if not exists public.training_work_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The work: one chat, in the table of its surface (as training_turn_notes).
  chat_id uuid references public.chats(id) on delete cascade,
  word_chat_id uuid references public.word_chats(id) on delete cascade,
  tabular_chat_id uuid references public.tabular_review_chats(id) on delete cascade,
  status text not null default 'pending',
  -- The newest turn note the review covers; a later note is new work.
  covered_through timestamptz,
  -- Lists of { source, text, ref? }.
  proposed jsonb,
  ai_corrected jsonb,
  doubts jsonb,
  unverified jsonb,
  signals jsonb not null default '{}'::jsonb,
  -- The mentor's route that generated it: identifiers only, as on chats.
  model_provider text,
  model text,
  credential_ref text,
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_work_reviews_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  -- Lets a defense point at a review of the same pupil only.
  constraint training_work_reviews_trainee_key unique (org_id, trainee_user_id, id),
  constraint training_work_reviews_one_chat check (
    num_nonnulls(chat_id, word_chat_id, tabular_chat_id) = 1
  ),
  constraint training_work_reviews_status_check check (
    status in ('pending', 'ready', 'failed')
  ),
  constraint training_work_reviews_route_check check (
    num_nonnulls(model_provider, model, credential_ref) in (0, 3)
  ),
  constraint training_work_reviews_ready_check check (
    status <> 'ready' or (
      proposed is not null and ai_corrected is not null and doubts is not null
      and unverified is not null and model_provider is not null and generated_at is not null
    )
  ),
  constraint training_work_reviews_content_check check (
    (proposed is null or (jsonb_typeof(proposed) = 'array' and octet_length(proposed::text) <= 20000))
    and (ai_corrected is null or (jsonb_typeof(ai_corrected) = 'array' and octet_length(ai_corrected::text) <= 20000))
    and (doubts is null or (jsonb_typeof(doubts) = 'array' and octet_length(doubts::text) <= 20000))
    and (unverified is null or (jsonb_typeof(unverified) = 'array' and octet_length(unverified::text) <= 20000))
    and jsonb_typeof(signals) = 'object' and octet_length(signals::text) <= 4000
  ),
  constraint training_work_reviews_reviewed_check check (
    reviewed_by is null or reviewed_at is not null
  )
);
-- One review per piece of work: regenerating updates that row.
create unique index if not exists training_work_reviews_chat_key
  on public.training_work_reviews(chat_id) where chat_id is not null;
create unique index if not exists training_work_reviews_word_chat_key
  on public.training_work_reviews(word_chat_id) where word_chat_id is not null;
create unique index if not exists training_work_reviews_tabular_chat_key
  on public.training_work_reviews(tabular_chat_id) where tabular_chat_id is not null;
create index if not exists training_work_reviews_trainee_idx
  on public.training_work_reviews(org_id, trainee_user_id, reviewed_at);

create table if not exists public.training_defenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The practice area it counts for, normalized as training_stages.practice;
  -- null means every practice area.
  practice text,
  -- The work it was about. The defense outlives that review: it is
  -- promotion evidence, deleted with the pupil.
  work_review_id uuid,
  -- [{ kind: 'base' | 'cambio_de_hechos', text, listen_for }]
  questions jsonb,
  questions_status text not null default 'none',
  model_provider text,
  model text,
  credential_ref text,
  generated_by uuid references auth.users(id) on delete set null,
  outcome text,
  outcome_note text,
  held_at timestamptz,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_defenses_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  constraint training_defenses_work_review_fkey foreign key (org_id, trainee_user_id, work_review_id)
    references public.training_work_reviews(org_id, trainee_user_id, id)
    on delete set null (work_review_id),
  constraint training_defenses_practice_check check (
    practice is null
    or (practice = lower(btrim(practice)) and practice <> '' and char_length(practice) <= 200)
  ),
  constraint training_defenses_questions_status_check check (
    questions_status in ('none', 'pending', 'ready', 'failed')
  ),
  constraint training_defenses_route_check check (
    num_nonnulls(model_provider, model, credential_ref) in (0, 3)
  ),
  -- Ready questions are five, exactly one of them a change of facts, each
  -- with its text and what the mentor should listen for.
  constraint training_defenses_questions_check check (
    (questions_status <> 'ready' or (questions is not null and model_provider is not null))
    and (questions is null or case when jsonb_typeof(questions) = 'array' then
      jsonb_array_length(questions) = 5
      and jsonb_array_length(jsonb_path_query_array(questions, '$[*] ? (@.kind == "cambio_de_hechos")')) = 1
      and jsonb_array_length(jsonb_path_query_array(questions, '$[*] ? (@.kind == "base")')) = 4
      and jsonb_array_length(jsonb_path_query_array(questions,
        '$[*] ? (@.text.type() == "string" && @.listen_for.type() == "string")')) = 5
      and octet_length(questions::text) <= 20000
    else false end)
  ),
  constraint training_defenses_outcome_check check (
    (outcome is null or outcome in ('approved', 'not_approved'))
    and (outcome is null) = (held_at is null)
    and (outcome_note is null or (outcome is not null and char_length(outcome_note) <= 4000))
    -- recorded_by is set with the outcome and goes to null with that account.
    and (recorded_by is null or outcome is not null)
  )
);
create index if not exists training_defenses_trainee_idx
  on public.training_defenses(org_id, trainee_user_id, created_at);
create index if not exists training_defenses_work_review_idx
  on public.training_defenses(work_review_id) where work_review_id is not null;

-- A defense's outcome is recorded once; correcting it is a new defense.
-- Only the recorder's id may still change, to null, when that account goes.
create or replace function public.training_defenses_outcome_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.outcome is not null and (
    new.outcome is distinct from old.outcome
    or new.outcome_note is distinct from old.outcome_note
    or new.held_at is distinct from old.held_at
    or (new.recorded_by is not null and new.recorded_by is distinct from old.recorded_by)
  ) then
    raise exception 'A training defense outcome is recorded once'
      using errcode = 'LT002';
  end if;
  return new;
end;
$$;
revoke all on function public.training_defenses_outcome_once() from public, anon, authenticated;

drop trigger if exists training_defenses_outcome_once on public.training_defenses;
create trigger training_defenses_outcome_once
  before update on public.training_defenses
  for each row execute function public.training_defenses_outcome_once();

create table if not exists public.training_urgency_passes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The matter's project the pass applies to.
  project_id uuid not null references public.projects(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- A closed list goes to the audit; the free note stays here (learning data).
  reason_code text not null,
  reason_note text,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A pass without a mentor makes no sense: releasing the pupil ends it.
  constraint training_urgency_passes_pupil_fkey foreign key (org_id, trainee_user_id)
    references public.training_pupils(org_id, trainee_user_id) on delete cascade,
  constraint training_urgency_passes_window_check check (expires_at > starts_at),
  constraint training_urgency_passes_reason_check check (
    reason_code in ('plazo', 'audiencia', 'cliente_urgente', 'otro')
    and (reason_note is null or char_length(reason_note) <= 500)
  ),
  constraint training_urgency_passes_revoked_check check (
    revoked_by is null or revoked_at is not null
  )
);
create index if not exists training_urgency_passes_trainee_idx
  on public.training_urgency_passes(org_id, trainee_user_id, project_id, expires_at);
create index if not exists training_urgency_passes_project_idx
  on public.training_urgency_passes(project_id);

alter table public.training_work_reviews enable row level security;
alter table public.training_defenses enable row level security;
alter table public.training_urgency_passes enable row level security;
revoke all on public.training_work_reviews from anon, authenticated;
revoke all on public.training_defenses from anon, authenticated;
revoke all on public.training_urgency_passes from anon, authenticated;
grant select, insert, update, delete on public.training_work_reviews to service_role;
grant select, insert, update, delete on public.training_defenses to service_role;
grant select, insert, update, delete on public.training_urgency_passes to service_role;

-- The one rule for learning data: the person themselves, or their current
-- mentor, both members of the organization. No role grants it.
create or replace function public.training_can_read_learning(
  p_actor uuid,
  p_org uuid,
  p_trainee uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1 from public.org_members m
      where m.org_id = p_org and m.user_id = p_trainee
    )
    and (
      p_actor = p_trainee
      or exists (
        select 1
        from public.training_pupils p
        join public.org_members mentor
          on mentor.org_id = p.org_id and mentor.user_id = p.mentor_user_id
        where p.org_id = p_org
          and p.trainee_user_id = p_trainee
          and p.mentor_user_id = p_actor
      )
    ),
    false
  );
$$;
revoke all on function public.training_can_read_learning(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.training_can_read_learning(uuid, uuid, uuid) to service_role;

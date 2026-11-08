-- Migration date: 2026-11-08
--
-- LiTT training, layer 3 card 13 «Contraste de criterios» (docs/training.md):
-- a junior hands the same assignment to two subagents, reads the two analyses
-- side by side, writes why they think they diverge BEFORE seeing the AI's own
-- explanation, and the AI's explanation is compared with theirs.
--
--   training_criteria_contrasts  one row per contrast: the routes the two
--                                subagents really ran on (identifiers only,
--                                never a credential), their two briefs, the
--                                person's explanation and the comparison.
--
-- It is learning data. training_can_read_learning(actor, org, trainee) decides
-- who reads it (the person and their CURRENT mentor; never an owner or an
-- admin); the backend asks it, and RLS is on with no policies or browser
-- grants, like the other training_* tables. The row hangs off the junior's
-- org_members row, so it goes when they leave the organization or their
-- account is erased (owner decision 2026-10-24); prepare_account_org_departures
-- is not changed. Releasing the junior keeps it. It goes with its chat.
--
-- Safe to re-run: if not exists, drop-before-create.

create table if not exists public.training_criteria_contrasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The conversation of the contrast (chat and project chat share this table).
  chat_id uuid not null references public.chats(id) on delete cascade,
  -- The assistant message of step 1, the one that ran the two subagents.
  message_id uuid not null,
  -- [{ name?, approach?, provider, model, status }]: what each subagent ran on.
  routes jsonb not null,
  -- The two briefs, in the order of routes; null when a subagent did not run.
  briefs jsonb,
  status text not null default 'awaiting_person',
  person_explanation text,
  comparison text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_criteria_contrasts_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  constraint training_criteria_contrasts_status_check check (
    status in ('awaiting_person', 'explained', 'failed')
  ),
  constraint training_criteria_contrasts_routes_check check (
    jsonb_typeof(routes) = 'array'
    and jsonb_array_length(routes) between 1 and 2
    and octet_length(routes::text) <= 4000
  ),
  constraint training_criteria_contrasts_briefs_check check (
    briefs is null
    or (
      jsonb_typeof(briefs) = 'array'
      and jsonb_array_length(briefs) between 1 and 2
      and octet_length(briefs::text) <= 40000
    )
  ),
  constraint training_criteria_contrasts_explanation_check check (
    (person_explanation is null or char_length(person_explanation) between 60 and 4000)
    and (comparison is null or char_length(comparison) between 1 and 4000)
    and (status <> 'explained' or (person_explanation is not null and comparison is not null))
    and (status <> 'awaiting_person' or (person_explanation is null and comparison is null and briefs is not null))
  )
);
create unique index if not exists training_criteria_contrasts_message_key
  on public.training_criteria_contrasts(message_id);
-- One contrast at a time waits for its explanation in a conversation.
create unique index if not exists training_criteria_contrasts_awaiting_key
  on public.training_criteria_contrasts(chat_id) where status = 'awaiting_person';
create index if not exists training_criteria_contrasts_trainee_idx
  on public.training_criteria_contrasts(org_id, trainee_user_id, created_at);
alter table public.training_criteria_contrasts enable row level security;
revoke all on public.training_criteria_contrasts from anon, authenticated;
grant select, insert, update, delete on public.training_criteria_contrasts to service_role;

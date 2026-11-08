-- Migration date: 2026-11-08
--
-- LiTT training, layer 3 card 8 «Modo de rendir cuentas» (docs/training.md):
-- after a junior's answer, the conclusions it makes and the source each one
-- rests on.
--
--   training_backing_checks  one row per assistant message of a junior: the
--                            conclusions the AI found in it, the citation it
--                            proposes for each, the status the SERVER computed
--                            from the verified citations (backed /
--                            citation_unverified / unbacked), and what the
--                            person did with it ("lo verifiqué", or why they
--                            keep an unbacked conclusion).
--
-- It is learning data. training_can_read_learning(actor, org, trainee) decides
-- who reads it (the person and their CURRENT mentor; never an owner or an
-- admin); the backend asks it, and RLS is on with no policies or browser
-- grants, like the other training_* tables. The row hangs off the junior's
-- org_members row, so it goes when they leave the organization or their
-- account is erased (owner decision 2026-10-24); prepare_account_org_departures
-- is not changed. Releasing the junior keeps it, like the turn notes. It
-- stores no passage: the exact passage is read from the persisted citations of
-- the message each time it is shown. The row goes with its chat.
--
-- Safe to re-run: if not exists, drop-before-create.

create table if not exists public.training_backing_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The work: one chat, in the table of its surface (as training_turn_notes).
  chat_id uuid references public.chats(id) on delete cascade,
  word_chat_id uuid references public.word_chats(id) on delete cascade,
  tabular_chat_id uuid references public.tabular_review_chats(id) on delete cascade,
  -- The assistant message the check is about.
  message_id uuid not null,
  status text not null default 'pending',
  -- A list of { id, text, citation_ref, status, unverified_references,
  -- person_verified, person_note }.
  conclusions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_backing_checks_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  constraint training_backing_checks_one_chat check (
    num_nonnulls(chat_id, word_chat_id, tabular_chat_id) = 1
  ),
  constraint training_backing_checks_status_check check (
    status in ('pending', 'ready', 'failed')
  ),
  constraint training_backing_checks_conclusions_check check (
    (status = 'ready') = (conclusions is not null)
    and (
      conclusions is null
      or (
        jsonb_typeof(conclusions) = 'array'
        and jsonb_array_length(conclusions) <= 12
        and octet_length(conclusions::text) <= 24000
      )
    )
  )
);
create unique index if not exists training_backing_checks_message_key
  on public.training_backing_checks(message_id);
create index if not exists training_backing_checks_chat_idx
  on public.training_backing_checks(chat_id) where chat_id is not null;
create index if not exists training_backing_checks_word_chat_idx
  on public.training_backing_checks(word_chat_id) where word_chat_id is not null;
create index if not exists training_backing_checks_tabular_chat_idx
  on public.training_backing_checks(tabular_chat_id) where tabular_chat_id is not null;
create index if not exists training_backing_checks_trainee_idx
  on public.training_backing_checks(org_id, trainee_user_id, created_at);
alter table public.training_backing_checks enable row level security;
revoke all on public.training_backing_checks from anon, authenticated;
grant select, insert, update, delete on public.training_backing_checks to service_role;

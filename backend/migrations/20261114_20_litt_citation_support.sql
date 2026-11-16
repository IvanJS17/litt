-- Migration date: 2026-11-14
--
-- Citation support check, silent mode (docs/citation-support-check.md).
--
-- 1. user_profiles.citation_check: the person's opt-out. On by default; false
--    keeps their answers' citations from being checked.
-- 2. citation_support_checks: what the check computed for each citation of an
--    assistant answer, from the chat or the Word add-in. References and
--    numbers only: never the text of the claim, the quote or its context, and
--    no person. The result is kept with the answer and deleted with it (on
--    delete cascade to the message); rows are never updated. It is not
--    independent evidence.
--
-- Re-runnable: columns and the table use if not exists, the guard trigger is
-- dropped before it is created.

alter table public.user_profiles
  add column if not exists citation_check boolean not null default true;

create table if not exists public.citation_support_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- The answer the check belongs to: a chat message or a Word chat message,
  -- one of the two. The result goes with the answer.
  message_id uuid references public.chat_messages(id) on delete cascade,
  word_message_id uuid references public.word_chat_messages(id) on delete cascade,
  -- The firm whose space the answer belongs to; null in a personal space. A
  -- reference for counting, not a foreign key.
  organization_id uuid,
  -- Which citation of the answer (its [n] marker). A citation with several
  -- quotes is one request, so one row.
  citation_ref integer not null,
  document_id uuid,
  version_id uuid,
  -- Where the quotes sit in the extracted text of the document (offsets only):
  -- the start of the first and the end of the last.
  start_char integer,
  end_char integer,
  -- P(the quote supports the claim), as Jev answered it, and its band.
  probability numeric(6, 5) not null check (probability >= 0 and probability <= 1),
  band text not null check (band in ('not_supported', 'review', 'supported')),
  -- The model that answered (the response's own `model`) and the question that
  -- was asked. No key, no text, no person.
  model text not null,
  question_version text not null,
  latency_ms integer not null check (latency_ms >= 0),
  input_tokens integer check (input_tokens >= 0),
  constraint citation_support_checks_one_message
    check ((message_id is null) <> (word_message_id is null))
);
create unique index if not exists citation_support_checks_chat_once
  on public.citation_support_checks (message_id, citation_ref, question_version)
  where message_id is not null;
create unique index if not exists citation_support_checks_word_once
  on public.citation_support_checks (word_message_id, citation_ref, question_version)
  where word_message_id is not null;
create index if not exists citation_support_checks_day_idx
  on public.citation_support_checks (created_at desc);

-- A check is never changed. It is removed only with its answer (the cascade).
create or replace function public.citation_support_checks_no_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'citation_support_checks rows are never updated'
    using errcode = '55000';
end;
$$;
revoke all on function public.citation_support_checks_no_update()
  from public, anon, authenticated;

drop trigger if exists citation_support_checks_no_update_trigger
  on public.citation_support_checks;
create trigger citation_support_checks_no_update_trigger
  before update on public.citation_support_checks
  for each row execute function public.citation_support_checks_no_update();

-- Server-only: the browser never reads or writes this table. RLS is on and the
-- only policies are the backend's (service_role), as for the AI evidence.
alter table public.citation_support_checks enable row level security;
revoke all on public.citation_support_checks from public, anon, authenticated;
grant select, insert on public.citation_support_checks to service_role;
drop policy if exists citation_support_checks_service_select on public.citation_support_checks;
create policy citation_support_checks_service_select on public.citation_support_checks
  for select to service_role using (true);
drop policy if exists citation_support_checks_service_insert on public.citation_support_checks;
create policy citation_support_checks_service_insert on public.citation_support_checks
  for insert to service_role with check (true);

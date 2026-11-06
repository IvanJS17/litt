-- Migration date: 2026-11-06
--
-- LiTT training, layer 1a (docs/training.md): mentors, their pupils and each
-- pupil's stage (`pasante` or `junior`) per practice area, inside an
-- organization; and a pasante's private notes on their chat turns
-- (training_turn_notes: the attempt they wrote and the contrast).
--
-- Every row hangs off the member's org_members row, so it disappears with
-- the membership (leaving, removal, organization deletion, account erasure).
-- A mentor who still has pupils cannot leave: org_members_training_departure
-- refuses, except in the two cascades that are not a choice (the organization
-- or the account itself is going) and during account erasure, which releases
-- the pupils first. Audit events about these rows stay (insert-only).
--
-- RLS is on and there are no policies or browser grants: every read and
-- write goes through the backend's training module.
--
-- Safe to re-run: if not exists, create or replace, drop-before-create.

create table if not exists public.training_mentors (
  org_id uuid not null,
  user_id uuid not null,
  designated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  constraint training_mentors_member_fkey foreign key (org_id, user_id)
    references public.org_members(org_id, user_id) on delete cascade
);

create table if not exists public.training_pupils (
  org_id uuid not null,
  trainee_user_id uuid not null,
  mentor_user_id uuid not null,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, trainee_user_id),
  constraint training_pupils_not_self check (trainee_user_id <> mentor_user_id),
  constraint training_pupils_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  -- A mentor with pupils is not retired: the pupils are released or moved first.
  constraint training_pupils_mentor_fkey foreign key (org_id, mentor_user_id)
    references public.training_mentors(org_id, user_id) on delete restrict
);
create index if not exists training_pupils_mentor_idx
  on public.training_pupils(org_id, mentor_user_id);

create table if not exists public.training_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  -- The project's practice area, normalized as lower(btrim(practice));
  -- null means every practice area.
  practice text,
  stage text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint training_stages_stage_check check (stage in ('pasante', 'junior')),
  constraint training_stages_practice_check check (
    practice is null
    or (practice = lower(btrim(practice)) and practice <> '' and char_length(practice) <= 200)
  ),
  constraint training_stages_pupil_fkey foreign key (org_id, trainee_user_id)
    references public.training_pupils(org_id, trainee_user_id) on delete cascade
);
create unique index if not exists training_stages_practice_key
  on public.training_stages(org_id, trainee_user_id, coalesce(practice, ''));

alter table public.training_mentors enable row level security;
alter table public.training_pupils enable row level security;
alter table public.training_stages enable row level security;
revoke all on public.training_mentors from anon, authenticated;
revoke all on public.training_pupils from anon, authenticated;
revoke all on public.training_stages from anon, authenticated;
grant select, insert, update, delete on public.training_mentors to service_role;
grant select, insert, update, delete on public.training_pupils to service_role;
grant select, insert, update, delete on public.training_stages to service_role;

-- A mentor with pupils cannot leave the organization (SQLSTATE LT001). When
-- the organization or the account itself is being deleted, the pupils are
-- released instead, so the cascade can finish.
create or replace function public.org_members_training_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.training_pupils
    where org_id = old.org_id and mentor_user_id = old.user_id
  ) then
    return old;
  end if;
  if not exists (select 1 from public.organizations where id = old.org_id)
     or not exists (select 1 from auth.users where id = old.user_id)
     or coalesce(current_setting('litt.training_erasure', true), '') = old.user_id::text then
    delete from public.training_pupils
      where org_id = old.org_id and mentor_user_id = old.user_id;
    return old;
  end if;
  raise exception 'A training mentor with pupils cannot leave the organization'
    using errcode = 'LT001';
end;
$$;
revoke all on function public.org_members_training_departure() from public, anon, authenticated;

drop trigger if exists org_members_training_departure on public.org_members;
create trigger org_members_training_departure
  before delete on public.org_members
  for each row execute procedure public.org_members_training_departure();

-- Account erasure takes the person out of every team organization; as a
-- mentor, their pupils are released rather than blocking the erasure.
create or replace function public.prepare_account_org_departures(p_user_id uuid)
returns void language plpgsql set search_path = public as $$
declare membership record;
begin
  -- Lock all organizations in a fixed order before changing any of them.
  perform o.id from public.organizations o join public.org_members m on m.org_id=o.id
    where m.user_id=p_user_id and o.kind='team' and o.deleted_at is null order by o.id for update of o;
  -- LiTT training: an erased mentor's pupils are released, not stranded.
  perform set_config('litt.training_erasure',p_user_id::text,true);
  for membership in select m.org_id from public.org_members m join public.organizations o on o.id=m.org_id
    where m.user_id=p_user_id and o.kind='team' and o.deleted_at is null order by m.org_id loop
    perform public.remove_org_member(membership.org_id,p_user_id,p_user_id,null);
  end loop;
  perform set_config('litt.training_erasure','',true);
end;
$$;
revoke all on function public.prepare_account_org_departures(uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_org_departures(uuid) to service_role;

-- A pasante's private notes: the attempt they wrote before a chat turn
-- ("Tu planteamiento") and the contrast the model produced afterwards with
-- the conversation's own provider, model and credential. They are learning
-- data: only the author and their current mentor read them (through the
-- backend; there is no policy or grant), and they are deleted with the
-- membership like the other training_* tables. The chat message itself
-- carries neither.
--
-- One note belongs to exactly one chat, in the table of the surface that
-- created it: chats (web and project chat), word_chats or
-- tabular_review_chats. A real foreign key per surface makes the note go with
-- its chat. message_id is the user message the note is about.
create table if not exists public.training_turn_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  chat_id uuid references public.chats(id) on delete cascade,
  word_chat_id uuid references public.word_chats(id) on delete cascade,
  tabular_chat_id uuid references public.tabular_review_chats(id) on delete cascade,
  message_id uuid not null,
  attempt text not null,
  contrast text,
  contrast_status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint training_turn_notes_member_fkey foreign key (org_id, trainee_user_id)
    references public.org_members(org_id, user_id) on delete cascade,
  constraint training_turn_notes_one_chat check (
    num_nonnulls(chat_id, word_chat_id, tabular_chat_id) = 1
  ),
  constraint training_turn_notes_attempt_check check (
    char_length(attempt) between 60 and 4000
  ),
  constraint training_turn_notes_status_check check (
    contrast_status in ('pending', 'ready', 'failed')
  ),
  constraint training_turn_notes_contrast_check check (
    (contrast_status = 'ready') = (contrast is not null)
    and (contrast is null or char_length(contrast) <= 8000)
  )
);
create unique index if not exists training_turn_notes_message_key
  on public.training_turn_notes(message_id);
create index if not exists training_turn_notes_chat_idx
  on public.training_turn_notes(chat_id) where chat_id is not null;
create index if not exists training_turn_notes_word_chat_idx
  on public.training_turn_notes(word_chat_id) where word_chat_id is not null;
create index if not exists training_turn_notes_tabular_chat_idx
  on public.training_turn_notes(tabular_chat_id) where tabular_chat_id is not null;
create index if not exists training_turn_notes_trainee_idx
  on public.training_turn_notes(org_id, trainee_user_id);
alter table public.training_turn_notes enable row level security;
revoke all on public.training_turn_notes from anon, authenticated;
grant select, insert, update, delete on public.training_turn_notes to service_role;

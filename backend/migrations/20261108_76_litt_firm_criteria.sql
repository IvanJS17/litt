-- Migration date: 2026-11-08
--
-- LiTT training, layer 3 (docs/training.md, "One mold of criterion"): the
-- firm's own criteria. A person of the firm writes a position, under their
-- name, on a subject (practice area and topic); a dissenting opinion
-- (voto_particular) also names the playbook rule it disagrees with. Pupils'
-- turns can consult them (the list_firm_criteria tool), so what the assistant
-- says "according to the firm" is always what a named person wrote.
--
-- firm_criteria is the FIRM's content, not learning data: it has no pupil
-- column and does not hang from a membership. The organization's members read
-- it; its author writes and edits it; an owner or admin may remove one.
-- Authorization lives in the backend (service_role); RLS is on and nothing is
-- granted to the browser roles.
--
--   - author_user_id goes to null when the account is erased: the criterion
--     stays with the firm, shown as written by a deleted user.
--   - playbook_id goes to null when the playbook is deleted; a dissenting
--     opinion keeps the rule id it named.
--   - A criterion states a position; LiTT gives it no legal authority and
--     stores no legal source for it.
--
-- Safe to re-run: create ... if not exists, drop-before-create for
-- constraints and policies. No rows are inserted.

create table if not exists public.firm_criteria (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'criterio',
  -- Normalized like training_stages.practice (lower, trimmed); null: any practice.
  practice text,
  topic text not null,
  position text not null,
  -- A dissenting opinion names the rule of a playbook it disagrees with.
  playbook_id uuid references public.playbooks(id) on delete set null,
  rule_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.firm_criteria drop constraint if exists firm_criteria_kind_check;
alter table public.firm_criteria add constraint firm_criteria_kind_check
  check (kind in ('criterio', 'voto_particular'));

alter table public.firm_criteria drop constraint if exists firm_criteria_text_check;
alter table public.firm_criteria add constraint firm_criteria_text_check
  check (
    char_length(btrim(topic)) between 1 and 120
    and char_length(btrim(position)) between 1 and 2000
    and (practice is null or (practice = lower(btrim(practice)) and char_length(practice) between 1 and 200))
  );

-- A criterion points at no rule; a dissenting opinion names one.
alter table public.firm_criteria drop constraint if exists firm_criteria_rule_check;
alter table public.firm_criteria add constraint firm_criteria_rule_check
  check (
    (kind = 'criterio' and playbook_id is null and rule_id is null)
    or (kind = 'voto_particular' and rule_id is not null and char_length(rule_id) between 1 and 100)
  );

create index if not exists firm_criteria_org_idx
  on public.firm_criteria(org_id, updated_at desc);
create index if not exists firm_criteria_author_idx
  on public.firm_criteria(author_user_id) where author_user_id is not null;
create index if not exists firm_criteria_playbook_idx
  on public.firm_criteria(playbook_id) where playbook_id is not null;

alter table public.firm_criteria enable row level security;
revoke all on public.firm_criteria from anon, authenticated;
grant select, insert, update, delete on public.firm_criteria to service_role;

-- Migration date: 2026-11-19
--
-- Tokens and engine of every AI call the retainer flows make (Donna triage,
-- slice T1: docs/ai-call-usage.md). One row per model call:
--
--   engine         'byok'  a model reached with the user's or the firm's own
--                          credential (the extraction, suggestion, proposal
--                          and question flows);
--                  'jev'   TypeSafe's Jev, with the platform key (triage
--                          classification, later slices).
--   provider/model the route that answered, as the call used it.
--   input_tokens / output_tokens
--                  what the provider reported for the call; null when it
--                  reported nothing (never a guess).
--   cost_usd       null unless the repo holds a price for that provider and
--                  model. It holds none for language models today, so the
--                  column stays null and the tokens are the record. Jev costs
--                  US$0.042 per million input tokens (output is free).
--
-- A row carries no text, quote, prompt, answer, name or key: only who, where
-- and how much. It is written once and never changed (a trigger refuses
-- update and delete), by the backend role only; the browser cannot read or
-- write it (no policy). The user and project columns have no foreign key, so
-- erasing an account or a project is never blocked by them.
--
-- The citation-support check rows already keep the model and the input tokens
-- of Jev's answers (citation_support_checks.model / .input_tokens); they are
-- not copied here. ai_executions is the assistant/tabular evidence record and
-- has no per-call usage: its route_provider / route_model stay as they are.
--
-- Re-runnable: table and indexes use if not exists, the function is create or
-- replace, the trigger is dropped before it is created, grants are idempotent.

create table if not exists public.ai_call_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  org_id uuid,
  user_id uuid,
  matter_id uuid,
  project_id uuid,
  surface text not null check (surface ~ '^[a-z][a-z0-9_.]*$' and char_length(surface) <= 80),
  engine text not null check (engine in ('byok', 'jev')),
  provider text not null check (btrim(provider) <> '' and char_length(provider) <= 80),
  model text not null check (btrim(model) <> '' and char_length(model) <= 120),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(14, 8) check (cost_usd >= 0)
);
-- The monthly count and the usage view of a firm.
create index if not exists ai_call_usage_org_created_idx
  on public.ai_call_usage (org_id, created_at desc);
create index if not exists ai_call_usage_surface_created_idx
  on public.ai_call_usage (surface, created_at desc);

create or replace function public.ai_call_usage_insert_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ai_call_usage is insert-only; % is not allowed', tg_op
    using errcode = '55000';
end;
$$;
revoke all on function public.ai_call_usage_insert_only() from public, anon, authenticated;

drop trigger if exists ai_call_usage_insert_only_trigger on public.ai_call_usage;
create trigger ai_call_usage_insert_only_trigger
  before update or delete on public.ai_call_usage
  for each row execute function public.ai_call_usage_insert_only();

-- Backend only: no policy, so no browser read or write.
alter table public.ai_call_usage enable row level security;
revoke all on public.ai_call_usage from public, anon, authenticated;
grant select, insert on public.ai_call_usage to service_role;

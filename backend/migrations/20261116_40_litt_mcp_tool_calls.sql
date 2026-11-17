-- Migration date: 2026-11-16
--
-- LiTT MCP server, layer 1 / slice 3: insert-only record of every call to a
-- LiTT MCP tool (design §7.4). One row per call, written by the backend with
-- the service role only: RLS is on with no policy, and anon/authenticated
-- lose every privilege.
--
-- A row says which tool ran, under which connection and person, in which
-- workspace, how it ended and how long it took. It never carries the
-- arguments, a result, document text, a key or a token.
--
-- Like mcp_oauth_audit, the table has no foreign key to auth.users or to
-- mcp_grants on purpose: deleting an account removes its connections and
-- the history stays.
-- Re-runnable: if not exists, create or replace, drop-before-create.

create table if not exists public.mcp_tool_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tool text not null,
  grant_id uuid,
  user_id uuid,
  client_id text,
  -- 'personal' or an organization id; null when the call named none.
  workspace text,
  -- Who ran the model: 'A' (LiTT) or 'B' (the client's own AI).
  mode text check (mode in ('A', 'B')),
  outcome text not null check (outcome in ('ok', 'error', 'denied', 'rate_limited')),
  error_code text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0)
);
create index if not exists mcp_tool_calls_user on public.mcp_tool_calls (user_id, created_at desc);
create index if not exists mcp_tool_calls_grant on public.mcp_tool_calls (grant_id, created_at desc);

create or replace function public.mcp_tool_calls_insert_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'mcp_tool_calls is insert-only; % is not allowed', tg_op
    using errcode = '55000';
end;
$$;
revoke all on function public.mcp_tool_calls_insert_only() from public, anon, authenticated;

drop trigger if exists mcp_tool_calls_insert_only_trigger on public.mcp_tool_calls;
create trigger mcp_tool_calls_insert_only_trigger
  before update or delete on public.mcp_tool_calls
  for each row execute function public.mcp_tool_calls_insert_only();

alter table public.mcp_tool_calls enable row level security;
revoke all on public.mcp_tool_calls from anon, authenticated;

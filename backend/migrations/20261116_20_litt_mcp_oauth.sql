-- Migration date: 2026-11-16
--
-- LiTT MCP server, layer 1 / slice 2: the OAuth authorization server that
-- issues tokens for the LiTT MCP endpoint (design §6). Everything here is
-- reached by the backend with the service role only: RLS is on with no
-- policy, and anon/authenticated lose every privilege.
--
--   mcp_oauth_clients   public clients: dynamic (DCR) and metadata-document
--                       (CIMD) registrations
--   mcp_oauth_requests  an /authorize request waiting for the person's
--                       consent page (short-lived)
--   mcp_grants          what a person consented to: client, workspaces,
--                       scopes, the resource the tokens are bound to
--   mcp_oauth_codes     authorization codes (hash only, single use)
--   mcp_oauth_tokens    access and refresh tokens (hash only); a refresh
--                       token is single use and its reuse revokes the grant
--   mcp_oauth_audit     insert-only record of registrations, consents,
--                       issuance, refresh reuse and revocations
--
-- Tokens, codes and request ids are never stored in clear. The audit table
-- has no foreign key to auth.users on purpose: deleting an account removes
-- its grants and tokens, and the audit history stays.
-- Re-runnable: if not exists, create or replace, drop-before-create.

create table if not exists public.mcp_oauth_clients (
  client_id text primary key,
  kind text not null check (kind in ('dcr', 'cimd', 'preregistered')),
  client_name text not null,
  redirect_uris text[] not null,
  client_uri text,
  logo_uri text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  fetched_at timestamptz,
  expires_at timestamptz
);
create index if not exists mcp_oauth_clients_kind_used
  on public.mcp_oauth_clients (kind, coalesce(last_used_at, created_at));

create table if not exists public.mcp_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients(client_id),
  resource text not null,
  scopes text[] not null,
  -- 'personal' and/or organization ids; one grant may cover several.
  workspaces text[] not null,
  default_workspace text not null,
  mfa_verified_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);
create index if not exists mcp_grants_user on public.mcp_grants (user_id, created_at desc);
create index if not exists mcp_grants_client on public.mcp_grants (client_id);

create table if not exists public.mcp_oauth_requests (
  id_hash text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  state text,
  code_challenge text not null,
  scopes text[] not null,
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz
);

create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references public.mcp_grants(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists mcp_oauth_codes_grant on public.mcp_oauth_codes (grant_id);

create table if not exists public.mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.mcp_grants(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mcp_oauth_tokens_grant on public.mcp_oauth_tokens (grant_id, kind);

create table if not exists public.mcp_oauth_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event text not null,
  user_id uuid,
  client_id text,
  grant_id uuid,
  detail jsonb
);
create index if not exists mcp_oauth_audit_user on public.mcp_oauth_audit (user_id, created_at desc);
create index if not exists mcp_oauth_audit_grant on public.mcp_oauth_audit (grant_id, created_at desc);

create or replace function public.mcp_oauth_audit_insert_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'mcp_oauth_audit is insert-only; % is not allowed', tg_op
    using errcode = '55000';
end;
$$;
revoke all on function public.mcp_oauth_audit_insert_only() from public, anon, authenticated;

drop trigger if exists mcp_oauth_audit_insert_only_trigger on public.mcp_oauth_audit;
create trigger mcp_oauth_audit_insert_only_trigger
  before update or delete on public.mcp_oauth_audit
  for each row execute function public.mcp_oauth_audit_insert_only();

-- Housekeeping, called by the registration endpoint: Claude registers a new
-- client on every new connection, so unused registrations must not pile up.
create or replace function public.mcp_oauth_purge()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.mcp_oauth_requests where expires_at < now() - interval '1 day';
  delete from public.mcp_oauth_codes where expires_at < now() - interval '1 day';
  delete from public.mcp_oauth_tokens where expires_at < now() - interval '1 day';
  delete from public.mcp_grants
    where expires_at < now() - interval '30 days'
       or revoked_at < now() - interval '30 days';
  delete from public.mcp_oauth_clients c
    where c.kind in ('dcr', 'cimd')
      and coalesce(c.last_used_at, c.created_at) < now() - interval '7 days'
      and not exists (select 1 from public.mcp_grants g where g.client_id = c.client_id);
end;
$$;
revoke all on function public.mcp_oauth_purge() from public, anon, authenticated;
grant execute on function public.mcp_oauth_purge() to service_role;

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_grants enable row level security;
alter table public.mcp_oauth_requests enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
alter table public.mcp_oauth_audit enable row level security;

revoke all on public.mcp_oauth_clients from anon, authenticated;
revoke all on public.mcp_grants from anon, authenticated;
revoke all on public.mcp_oauth_requests from anon, authenticated;
revoke all on public.mcp_oauth_codes from anon, authenticated;
revoke all on public.mcp_oauth_tokens from anon, authenticated;
revoke all on public.mcp_oauth_audit from anon, authenticated;

-- Migration date: 2026-10-22
--
-- Connectors, per workspace.
--
-- MCP, Google Drive, Gmail and Calendar connections belonged to the account
-- and were switched off in every organization's workspace.
--
-- A person now keeps a separate set of connections for Personal and for each
-- team organization they belong to. Each is private to them, like their
-- workspace memory: not shared with the organization and not usable by its
-- other members. A conversation uses only the connections of the workspace it
-- is in.
--
--   <connector table>.org_id   the organization a connection is for, or null
--                              for Personal
--
-- A workspace connection exists only while its person is a member: it is
-- tied to the membership row and goes with it, so leaving, being removed and
-- the organization being purged all delete the stored credentials.
--
-- Existing connections become Personal.
--
-- LiTT (ledger 16.3 "CourtListener", cycle 2026-10-24): upstream's version of
-- this migration also creates user_courtlistener_connections and moves the
-- CourtListener switch and tokens into it. CourtListener is not part of LiTT
-- (20261023_18_litt_remove_courtlistener), so that section is left out here:
-- it would read user_profiles.legal_research_us, which LiTT has dropped, and
-- delete saved 'courtlistener' keys that 20261023_18 stops on instead.
--
-- Safe to re-run: add column if not exists, drop-before-create for
-- constraints and replaced functions, guarded backfills.

-- ---------------------------------------------------------------------------
-- MCP connectors. Tokens, tools, OAuth states and audit rows hang off the
-- connector and follow it.
-- ---------------------------------------------------------------------------

alter table public.user_mcp_connectors
  add column if not exists org_id uuid;

alter table public.user_mcp_connectors
  drop constraint if exists user_mcp_connectors_workspace_member_fkey;
alter table public.user_mcp_connectors
  add constraint user_mcp_connectors_workspace_member_fkey
  foreign key (org_id, user_id)
  references public.org_members(org_id, user_id) on delete cascade;

drop index if exists public.idx_user_mcp_connectors_user;
create index if not exists idx_user_mcp_connectors_user_workspace
  on public.user_mcp_connectors(user_id, org_id);
create index if not exists idx_user_mcp_connectors_org
  on public.user_mcp_connectors(org_id) where org_id is not null;

-- ---------------------------------------------------------------------------
-- Google Drive: one grant per person per workspace.
-- ---------------------------------------------------------------------------

alter table public.user_google_drive_tokens
  add column if not exists id uuid not null default gen_random_uuid();
alter table public.user_google_drive_tokens
  add column if not exists org_id uuid;

alter table public.user_google_drive_tokens
  drop constraint if exists user_google_drive_tokens_pkey;
alter table public.user_google_drive_tokens
  add constraint user_google_drive_tokens_pkey primary key (id);

-- Null is Personal and must collide with itself.
alter table public.user_google_drive_tokens
  drop constraint if exists user_google_drive_tokens_workspace_key;
alter table public.user_google_drive_tokens
  add constraint user_google_drive_tokens_workspace_key
  unique nulls not distinct (user_id, org_id);

alter table public.user_google_drive_tokens
  drop constraint if exists user_google_drive_tokens_workspace_member_fkey;
alter table public.user_google_drive_tokens
  add constraint user_google_drive_tokens_workspace_member_fkey
  foreign key (org_id, user_id)
  references public.org_members(org_id, user_id) on delete cascade;

create index if not exists idx_user_google_drive_tokens_org
  on public.user_google_drive_tokens(org_id) where org_id is not null;

-- ---------------------------------------------------------------------------
-- Gmail and Calendar: one grant per person per workspace per service.
-- ---------------------------------------------------------------------------

alter table public.user_google_workspace_tokens
  add column if not exists id uuid not null default gen_random_uuid();
alter table public.user_google_workspace_tokens
  add column if not exists org_id uuid;

alter table public.user_google_workspace_tokens
  drop constraint if exists user_google_workspace_tokens_pkey;
alter table public.user_google_workspace_tokens
  add constraint user_google_workspace_tokens_pkey primary key (id);

alter table public.user_google_workspace_tokens
  drop constraint if exists user_google_workspace_tokens_workspace_key;
alter table public.user_google_workspace_tokens
  add constraint user_google_workspace_tokens_workspace_key
  unique nulls not distinct (user_id, org_id, provider);

alter table public.user_google_workspace_tokens
  drop constraint if exists user_google_workspace_tokens_workspace_member_fkey;
alter table public.user_google_workspace_tokens
  add constraint user_google_workspace_tokens_workspace_member_fkey
  foreign key (org_id, user_id)
  references public.org_members(org_id, user_id) on delete cascade;

create index if not exists idx_user_google_workspace_tokens_org
  on public.user_google_workspace_tokens(org_id) where org_id is not null;

-- A pending Google sign-in remembers the workspace it was started in, so the
-- callback completes that workspace's grant and no other.
alter table public.google_workspace_oauth_states
  add column if not exists org_id uuid;

alter table public.google_workspace_oauth_states
  drop constraint if exists google_workspace_oauth_states_workspace_member_fkey;
alter table public.google_workspace_oauth_states
  add constraint google_workspace_oauth_states_workspace_member_fkey
  foreign key (org_id, user_id)
  references public.org_members(org_id, user_id) on delete cascade;

create or replace function public.complete_google_drive_oauth(p_state_hash text, p_tokens jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_org_id uuid;
begin
  select user_id into v_user_id from public.google_workspace_oauth_states
    where state_hash = p_state_hash and provider = 'google-drive';
  if not found then return false; end if;
  perform 1 from auth.users where id = v_user_id for update;
  if not found then return false; end if;
  -- The workspace the sign-in was started in.
  delete from public.google_workspace_oauth_states
    where state_hash = p_state_hash and provider = 'google-drive'
      and user_id = v_user_id and expires_at > now()
    returning org_id into v_org_id;
  if not found then return false; end if;
  insert into public.user_google_drive_tokens (
    user_id, org_id, account_email, encrypted_access_token, access_token_iv, access_token_tag,
    encrypted_refresh_token, refresh_token_iv, refresh_token_tag, scope, expires_at
  ) values (
    v_user_id, v_org_id, p_tokens->>'account_email', p_tokens->>'encrypted_access_token',
    p_tokens->>'access_token_iv', p_tokens->>'access_token_tag',
    p_tokens->>'encrypted_refresh_token', p_tokens->>'refresh_token_iv',
    p_tokens->>'refresh_token_tag', p_tokens->>'scope',
    (p_tokens->>'expires_at')::timestamptz
  ) on conflict (user_id, org_id) do update set
    grant_id = gen_random_uuid(),
    account_email = excluded.account_email,
    encrypted_access_token = excluded.encrypted_access_token,
    access_token_iv = excluded.access_token_iv, access_token_tag = excluded.access_token_tag,
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    refresh_token_iv = excluded.refresh_token_iv, refresh_token_tag = excluded.refresh_token_tag,
    scope = excluded.scope, expires_at = excluded.expires_at, updated_at = now();
  return true;
end;
$$;
revoke all on function public.complete_google_drive_oauth(text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_google_drive_oauth(text, jsonb) to service_role;

-- p_org_id defaults to Personal, so a backend that predates this migration
-- still disconnects the connection it knows about.
drop function if exists public.disconnect_google_drive(uuid);
create or replace function public.disconnect_google_drive(p_user_id uuid, p_org_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token jsonb;
begin
  perform 1 from auth.users where id = p_user_id for update;
  if not found then return null; end if;
  delete from public.google_workspace_oauth_states
    where user_id = p_user_id and provider = 'google-drive'
      and org_id is not distinct from p_org_id;
  delete from public.user_google_drive_tokens
    where user_id = p_user_id and org_id is not distinct from p_org_id
    returning to_jsonb(user_google_drive_tokens) into v_token;
  return v_token;
end;
$$;
revoke all on function public.disconnect_google_drive(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_google_drive(uuid, uuid) to service_role;

create or replace function public.complete_google_workspace_oauth(p_state_hash text, p_provider text, p_tokens jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_state public.google_workspace_oauth_states;
begin
  select * into v_state from public.google_workspace_oauth_states where state_hash = p_state_hash and provider = p_provider;
  if not found then return false; end if;
  perform 1 from auth.users where id = v_state.user_id for update;
  if not found then return false; end if;
  delete from public.google_workspace_oauth_states where state_hash = p_state_hash and provider = p_provider and expires_at > now() returning * into v_state;
  if not found then return false; end if;
  insert into public.user_google_workspace_tokens(user_id, org_id, provider, account_email, account_id, encrypted_access_token, access_token_iv, access_token_tag, encrypted_refresh_token, refresh_token_iv, refresh_token_tag, scope, expires_at, write_enabled)
  values (v_state.user_id, v_state.org_id, p_provider, p_tokens->>'account_email', p_tokens->>'account_id', p_tokens->>'encrypted_access_token', p_tokens->>'access_token_iv', p_tokens->>'access_token_tag', p_tokens->>'encrypted_refresh_token', p_tokens->>'refresh_token_iv', p_tokens->>'refresh_token_tag', p_tokens->>'scope', (p_tokens->>'expires_at')::timestamptz, coalesce((p_tokens->>'write_enabled')::boolean, false))
  on conflict (user_id, org_id, provider) do update set
    grant_id = gen_random_uuid(), account_email = excluded.account_email, account_id = excluded.account_id, encrypted_access_token = excluded.encrypted_access_token,
    access_token_iv = excluded.access_token_iv, access_token_tag = excluded.access_token_tag,
    encrypted_refresh_token = excluded.encrypted_refresh_token, refresh_token_iv = excluded.refresh_token_iv, refresh_token_tag = excluded.refresh_token_tag,
    scope = excluded.scope, expires_at = excluded.expires_at, write_enabled = excluded.write_enabled;
  return true;
end;
$$;

drop function if exists public.disconnect_google_workspace(uuid, text);
create or replace function public.disconnect_google_workspace(p_user_id uuid, p_provider text, p_org_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id = p_user_id for update;
  if not found then return; end if;
  delete from public.google_workspace_oauth_states
    where user_id = p_user_id and provider = p_provider
      and org_id is not distinct from p_org_id;
  delete from public.user_google_workspace_tokens
    where user_id = p_user_id and provider = p_provider
      and org_id is not distinct from p_org_id;
end;
$$;

revoke all on function public.complete_google_workspace_oauth(text,text,jsonb), public.disconnect_google_workspace(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.complete_google_workspace_oauth(text,text,jsonb), public.disconnect_google_workspace(uuid,text,uuid) to service_role;

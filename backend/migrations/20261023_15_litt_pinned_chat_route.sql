-- Migration date: 2026-10-23
--
-- Governed BYOK: a conversation runs on one route, provider + model +
-- credential, chosen when it is created and fixed on it (LiTT sync
-- 2026-10-23, S3; docs/UPSTREAM_SYNC_PLAN.md §5 "S3", ledger §16.3
-- "Provider catalog, credentials and model selection").
--
-- 1. Saved keys (personal and organization) carry a version and a
--    credential_ref (`<provider>:v<version>`) assigned by the database. A new
--    key, a re-enabled key or a changed setting (region, endpoint, base URL)
--    is a new version, so a conversation pinned to the previous one fails
--    closed instead of quietly running on a different secret or destination.
-- 2. chats regain model_provider and credential_ref (dropped upstream). The
--    consistency check is NOT VALID: rows written before this migration may
--    carry a model without a provider; they are pinned on their next turn.
--    Every new or updated row is checked.
-- 3. 'opencode-zen' becomes a key provider (fixed-host OpenAI-compatible
--    entry; DeepSeek already had its key type).
--
-- Re-runnable: add column if not exists, create or replace, drop-before-create
-- for triggers and constraints.

alter table public.user_api_keys
  add column if not exists version integer not null default 1;
alter table public.user_api_keys
  add column if not exists credential_ref text;
alter table public.org_api_keys
  add column if not exists version integer not null default 1;
alter table public.org_api_keys
  add column if not exists credential_ref text;

update public.user_api_keys
   set credential_ref = provider || ':v' || version::text
 where credential_ref is null;
update public.org_api_keys
   set credential_ref = provider || ':v' || version::text
 where credential_ref is null;

alter table public.user_api_keys alter column credential_ref set not null;
alter table public.org_api_keys alter column credential_ref set not null;

create or replace function public.assign_api_key_credential_ref()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.version := 1;
  elsif new.provider is distinct from old.provider
     or (new.enabled and not old.enabled)
     or new.encrypted_key is distinct from old.encrypted_key
     or new.iv is distinct from old.iv
     or new.auth_tag is distinct from old.auth_tag
     or new.settings is distinct from old.settings
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  new.credential_ref := new.provider || ':v' || new.version::text;
  return new;
end;
$$;
revoke all on function public.assign_api_key_credential_ref() from public, anon, authenticated;

drop trigger if exists assign_user_api_key_credential_ref on public.user_api_keys;
create trigger assign_user_api_key_credential_ref
  before insert or update on public.user_api_keys
  for each row execute function public.assign_api_key_credential_ref();

drop trigger if exists assign_org_api_key_credential_ref on public.org_api_keys;
create trigger assign_org_api_key_credential_ref
  before insert or update on public.org_api_keys
  for each row execute function public.assign_api_key_credential_ref();

alter table public.user_api_keys drop constraint if exists user_api_keys_provider_check;
alter table public.user_api_keys add constraint user_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'mistral', 'openrouter', 'vercel', 'opencode-go', 'opencode-zen', 'bedrock', 'azure', 'azure-foundry', 'vertex', 'xai', 'custom', 'courtlistener', 'brave', 'tavily', 'deepseek'));
alter table public.org_api_keys drop constraint if exists org_api_keys_provider_check;
alter table public.org_api_keys add constraint org_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'mistral', 'openrouter', 'vercel', 'opencode-go', 'opencode-zen', 'bedrock', 'azure', 'azure-foundry', 'vertex', 'xai', 'custom', 'courtlistener', 'brave', 'tavily', 'deepseek'));

alter table public.chats add column if not exists model_provider text;
alter table public.chats add column if not exists credential_ref text;
alter table public.chats drop constraint if exists chats_model_route_consistent;
alter table public.chats add constraint chats_model_route_consistent check (
  (model_provider is null and credential_ref is null)
  or (model_provider is not null and model is not null and credential_ref is not null
      and btrim(credential_ref) <> '')
) not valid;

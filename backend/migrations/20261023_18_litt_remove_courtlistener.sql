-- Migration date: 2026-10-23
--
-- CourtListener is not part of LiTT (TD-013; ledger §16 "CourtListener",
-- LiTT sync 2026-10-23, S7). It is a US case-law service, not a Mexican
-- authority. The upstream migrations that created its index tables, its key
-- type and the "US legal research" profile preference stay in the series as
-- history; this migration removes what they left behind:
--
-- 1. 'courtlistener' is no longer a key provider for personal or
--    organization keys. A saved CourtListener key is never silently deleted:
--    the migration stops and asks for an owner decision instead.
-- 2. The two bulk-data index tables are dropped (public case-law metadata,
--    no customer data).
-- 3. user_profiles.legal_research_us is dropped; no research tool reads it.
--
-- Re-runnable: guarded checks, drop-before-add constraints, if exists.

do $$ begin
  if exists (select 1 from public.user_api_keys where provider = 'courtlistener' limit 1)
     or exists (select 1 from public.org_api_keys where provider = 'courtlistener' limit 1) then
    raise exception 'saved CourtListener keys require an owner decision before removal';
  end if;
end $$;

alter table public.user_api_keys drop constraint if exists user_api_keys_provider_check;
alter table public.user_api_keys add constraint user_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'mistral', 'openrouter', 'vercel', 'opencode-go', 'opencode-zen', 'bedrock', 'azure', 'azure-foundry', 'vertex', 'xai', 'custom', 'brave', 'tavily', 'deepseek'));
alter table public.org_api_keys drop constraint if exists org_api_keys_provider_check;
alter table public.org_api_keys add constraint org_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'mistral', 'openrouter', 'vercel', 'opencode-go', 'opencode-zen', 'bedrock', 'azure', 'azure-foundry', 'vertex', 'xai', 'custom', 'brave', 'tavily', 'deepseek'));

drop table if exists public.courtlistener_citation_index;
drop table if exists public.courtlistener_opinion_cluster_index;

alter table public.user_profiles drop column if exists legal_research_us;

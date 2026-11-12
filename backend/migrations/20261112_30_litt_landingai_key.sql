-- Migration date: 2026-11-12
--
-- Scan reading (layer 6). 'landingai' becomes a key provider for personal and
-- organization keys, next to the web-search backends: the owner's own key,
-- encrypted like the others. It is not an AI model provider and there is no
-- platform key for it. Existing keys, RLS and grants are unchanged.
-- Re-runnable: the constraints are dropped and re-added.

alter table public.user_api_keys drop constraint if exists user_api_keys_provider_check;
alter table public.user_api_keys add constraint user_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'mistral', 'openrouter', 'vercel', 'opencode-go', 'opencode-zen', 'bedrock', 'azure', 'azure-foundry', 'vertex', 'xai', 'custom', 'brave', 'tavily', 'deepseek', 'landingai'));
alter table public.org_api_keys drop constraint if exists org_api_keys_provider_check;
alter table public.org_api_keys add constraint org_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'mistral', 'openrouter', 'vercel', 'opencode-go', 'opencode-zen', 'bedrock', 'azure', 'azure-foundry', 'vertex', 'xai', 'custom', 'brave', 'tavily', 'deepseek', 'landingai'));

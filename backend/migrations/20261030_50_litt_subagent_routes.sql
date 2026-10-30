-- Migration date: 2026-10-30
--
-- LiTT (owner decision 2026-10-30, ledger 16 "Web search and subagents in
-- chat"): the named model routes a user lets chat subagents run on, from
-- Settings > Subagents. One JSON column holding {routes, default}; the
-- backend validates every route on save (lib/subagentRoutes.ts). Upstream's
-- subagent_model / subagent_reasoning columns are left as they are.
--
-- Safe to re-run: add column if not exists, drop constraint before adding.

alter table public.user_profiles
  add column if not exists subagent_routes jsonb not null
    default '{"routes": [], "default": null}'::jsonb;

alter table public.user_profiles
  drop constraint if exists user_profiles_subagent_routes_check;
alter table public.user_profiles
  add constraint user_profiles_subagent_routes_check
  check (
    jsonb_typeof(subagent_routes) = 'object'
    and octet_length(subagent_routes::text) <= 6000
  );

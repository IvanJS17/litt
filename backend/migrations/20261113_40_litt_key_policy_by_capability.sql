-- Migration date: 2026-11-13
--
-- Members' own keys, decided by capability.
--
-- organizations.allow_personal_api_keys was one switch for three different
-- things: AI model keys, web-search keys (Brave, Tavily, DeepSeek) and the
-- scan-reading key (LandingAI). A firm that wanted its members on the firm's
-- AI account but free to bring their own search key could not say so. It is
-- replaced by one switch per capability:
--
--   allow_personal_ai_keys           model providers (chat, review, helpers)
--   allow_personal_web_search_keys   Brave, Tavily, DeepSeek
--   allow_personal_scan_keys         LandingAI (scan reading, case-file split)
--
-- Nobody changes behaviour: each new column starts with the value the old
-- column has for that organization, then the old column is dropped. No
-- policy, view or SQL function reads it (checked before writing this).
--
-- Re-runnable: the copy only runs while the old column still exists.

alter table public.organizations
  add column if not exists allow_personal_ai_keys boolean not null default true,
  add column if not exists allow_personal_web_search_keys boolean not null default true,
  add column if not exists allow_personal_scan_keys boolean not null default true;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'allow_personal_api_keys'
  ) then
    update public.organizations
    set allow_personal_ai_keys = allow_personal_api_keys,
        allow_personal_web_search_keys = allow_personal_api_keys,
        allow_personal_scan_keys = allow_personal_api_keys;
    alter table public.organizations drop column allow_personal_api_keys;
  end if;
end
$$;

-- Migration date: 2026-11-07
-- LiTT: interface language each user chooses (English or Spanish).
-- NULL means "not chosen": the app negotiates the language from the browser
-- (or Word) and falls back to es-MX. The backend copies the value to
-- auth.users.raw_user_meta_data.locale so the GoTrue emails can use it.
alter table public.user_profiles
  add column if not exists ui_locale text;

alter table public.user_profiles
  drop constraint if exists user_profiles_ui_locale_check;
alter table public.user_profiles
  add constraint user_profiles_ui_locale_check
  check (ui_locale is null or ui_locale in ('en-US', 'es-MX'));

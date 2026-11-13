-- Migration date: 2026-11-13
--
-- LiTT: the text size each person chooses in Settings > Appearance.
-- 'normal' is 100 %, 'large' 112.5 % and 'xlarge' 125 % of the browser's base
-- size. Existing and new accounts stay on 'normal'. Re-runnable.
alter table public.user_profiles
  add column if not exists text_size text not null default 'normal';

alter table public.user_profiles
  drop constraint if exists user_profiles_text_size_check;
alter table public.user_profiles
  add constraint user_profiles_text_size_check
  check (text_size in ('normal', 'large', 'xlarge'));

-- Migration date: 2026-11-14
--
-- LiTT: one theme preference with three values, Claro, Oscuro and Automático
-- ('light', 'dark', 'system'), in place of the dark_mode boolean. Whoever had
-- Dark Mode on becomes 'dark' and everyone else 'light', so nobody sees a
-- change; new accounts start on 'system' (they follow the device). dark_mode
-- is dropped: the API carries `theme` and nothing else. Re-runnable: once
-- dark_mode is gone, the block that reads it is skipped.
alter table public.user_profiles
  add column if not exists theme text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'dark_mode'
  ) then
    update public.user_profiles
      set theme = case when coalesce(dark_mode, false) then 'dark' else 'light' end
      where theme is null;
    alter table public.user_profiles drop column dark_mode;
  end if;
end
$$;

update public.user_profiles set theme = 'system' where theme is null;

alter table public.user_profiles
  alter column theme set default 'system',
  alter column theme set not null;

alter table public.user_profiles
  drop constraint if exists user_profiles_theme_check;
alter table public.user_profiles
  add constraint user_profiles_theme_check
  check (theme in ('light', 'dark', 'system'));

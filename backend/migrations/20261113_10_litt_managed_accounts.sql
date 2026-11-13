-- Migration date: 2026-11-13
--
-- Accounts managed by the firm (docs/managed-accounts.md).
--
-- 1. organizations.managed_accounts: a firm setting. When on, the accounts the
--    firm invited and that were created by that invitation have no personal
--    space: they work in the firm's workspace, on the firm's keys. Off by
--    default; changed only by the backend (owner or admin, audited).
-- 2. user_profiles.created_by_org_id: the firm whose invitation created the
--    account. Set once, by the backend, when the invitation email makes a new
--    account (GoTrue inviteUserByEmail). An account that already existed
--    before an invitation keeps NULL, and so does every account that signed up
--    on its own. The firm going away clears it (on delete set null).
--
-- An account is managed while its creating firm has the setting on AND the
-- person is still a member of that firm. That second half is evaluated by the
-- backend on every request; nothing here is copied or cached, so leaving the
-- firm or turning the setting off applies at once.
--
-- No client role can write either column: organizations and user_profiles
-- are revoked from anon and authenticated, and nothing is granted back.
--
-- Re-runnable: both columns use if not exists.

alter table public.organizations
  add column if not exists managed_accounts boolean not null default false;

alter table public.user_profiles
  add column if not exists created_by_org_id uuid
  references public.organizations(id) on delete set null;

create index if not exists idx_user_profiles_created_by_org
  on public.user_profiles(created_by_org_id)
  where created_by_org_id is not null;

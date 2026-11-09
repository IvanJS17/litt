-- Migration date: 2026-11-09
--
-- Acceptance of the published Terms and Privacy Notice: the version the
-- user accepted and when. The version is compared with LEGAL_VERSION in
-- the backend; a different value makes the profile report termsRequired.

alter table public.user_profiles
  add column if not exists terms_accepted_version text,
  add column if not exists terms_accepted_at timestamptz;

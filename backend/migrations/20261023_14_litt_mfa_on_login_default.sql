-- Migration date: 2026-10-23
--
-- MFA on sign-in is on by default (LiTT sync 2026-10-23, S2; ledger §16.3
-- "Sign-in, MFA and identity": the LiTT variant wins on MFA). It only takes
-- effect for an account that has enrolled a factor: sign-in then requires
-- it. Existing rows keep the choice already made.
--
-- Re-runnable: set default is idempotent.

alter table public.user_profiles alter column mfa_on_login set default true;

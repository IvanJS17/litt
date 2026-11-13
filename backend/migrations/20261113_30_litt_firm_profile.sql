-- Migration date: 2026-11-13
--
-- The firm's profile (docs/firm-profile.md): a short description of the firm
-- adapted to Mexico (home state and city, other states, size, practice areas,
-- kind of clients, industries, language of briefs, and a free description of up
-- to 1,000 characters). The assistant adds it to every chat of the firm's
-- workspace; it is never added to a personal space or to another firm.
--
-- One jsonb value on organizations, like split_classes: NULL means "no
-- profile". Members can read it through the existing organizations select
-- policy; no client role can write it (organizations is revoked from anon and
-- authenticated, and nothing is granted back). The backend is the only writer:
-- owners and admins, with MFA when enrolled, audited as org.profile.updated
-- (the names of the fields that changed, never their values). The server
-- validates the shape; the database refuses anything that is not an object or
-- is over 6,000 bytes of jsonb text.
--
-- Re-runnable: the column uses if not exists and the constraint is re-added.

alter table public.organizations
  add column if not exists firm_profile jsonb;
alter table public.organizations
  drop constraint if exists organizations_firm_profile_check;
alter table public.organizations
  add constraint organizations_firm_profile_check
  check (firm_profile is null or (
    jsonb_typeof(firm_profile) = 'object'
    and octet_length(firm_profile::text) <= 6000
  ));

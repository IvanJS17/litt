-- Migration date: 2026-11-09
--
-- Invite-only access (docs/make PLAN-acceso-beta): a platform administrator
-- (PLATFORM_ADMIN_EMAILS) invites an email to sign up and create ONE
-- organization. The row is matched by the normalized email, nothing else.
--
-- The email is the invited person's personal data: a cancelled invitation is
-- deleted (the audit keeps ids only), and erasing the inviter's account nulls
-- invited_by. RLS is on and nothing is granted to the browser roles; only the
-- backend (service_role) reads it.

create table if not exists public.platform_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint platform_invitations_email_lowercase check (email = lower(email)),
  constraint platform_invitations_status_check
    check (status in ('pending', 'used', 'cancelled'))
);

-- One pending invitation per email.
create unique index if not exists platform_invitations_pending_unique
  on public.platform_invitations(email) where status = 'pending';

alter table public.platform_invitations enable row level security;
revoke all on public.platform_invitations from anon, authenticated;
grant select, insert, update, delete on public.platform_invitations to service_role;

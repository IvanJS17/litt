-- Migration date: 2026-11-21
--
-- When a person last ended all their sessions (signing out everywhere, or
-- recovering the password with the sign-out option). The applications they
-- connected through the MCP server are credentials of the account issued by
-- LiTT, not auth-service sessions, so the auth service cannot end them; the
-- connection checks read this column and refuse a connection (and its
-- tokens and authorization codes) made at or before it. A connection made
-- afterwards is unaffected. NULL means the person never did.
--
-- user_profiles is not readable or writable by the browser roles (all
-- privileges revoked), so only the backend sets it.
--
-- Re-runnable: the column is added with if not exists.

alter table public.user_profiles
  add column if not exists sessions_ended_at timestamptz;

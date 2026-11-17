-- Migration date: 2026-11-17
--
-- LiTT MCP server: table privileges for the service role.
--
-- 20261116_20_litt_mcp_oauth.sql and 20261116_40_litt_mcp_tool_calls.sql
-- revoked anon/authenticated but never granted the service role, which the
-- backend uses for every MCP read and write. Where the public schema has no
-- default privileges for new tables (production), registration failed with
-- 42501. Every other LiTT table grants explicitly; these now do too.
--
-- The OAuth tables need delete because mcp_oauth_purge() runs as the caller.
-- The two audit tables stay insert-only (their triggers refuse update and
-- delete anyway). Re-runnable: grant is idempotent.

grant select, insert, update, delete on
  public.mcp_oauth_clients,
  public.mcp_oauth_requests,
  public.mcp_grants,
  public.mcp_oauth_codes,
  public.mcp_oauth_tokens
  to service_role;

grant select, insert on public.mcp_oauth_audit, public.mcp_tool_calls to service_role;

-- Run only on a disposable database that already has backend/schema.sql, from
-- backend/scripts/ (psql -f), as its owner. Everything is rolled back.
--
-- Connectors ask the person before they write, by default:
--   1. a new connector row (MCP server, Google Drive, Google Workspace) asks
--      unless the row says otherwise;
--   2. the migration switches on the connectors already linked, and a second
--      run does not switch back on one the person turned off in between.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', label; end if;
end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test');

-- 1. A new connector asks by default; an explicit false is respected.
insert into public.user_mcp_connectors(id, user_id, name, server_url)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'new', 'https://mcp.example.test');
insert into public.user_mcp_connectors(id, user_id, name, server_url, require_write_approval)
values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'chosen off', 'https://mcp.example.test', false);
insert into public.user_google_drive_tokens(user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.user_google_drive_tokens(user_id, require_write_approval) values ('00000000-0000-0000-0000-0000000000a2', false);
insert into public.user_google_workspace_tokens(user_id, provider, account_email, account_id,
  encrypted_access_token, access_token_iv, access_token_tag, encrypted_refresh_token, refresh_token_iv, refresh_token_tag,
  scope, expires_at)
values ('00000000-0000-0000-0000-0000000000a1', 'gmail', 'a@example.test', 'g1', 'x', 'x', 'x', 'x', 'x', 'x', 's', now());
insert into public.user_google_workspace_tokens(user_id, provider, account_email, account_id,
  encrypted_access_token, access_token_iv, access_token_tag, encrypted_refresh_token, refresh_token_iv, refresh_token_tag,
  scope, expires_at, require_write_approval)
values ('00000000-0000-0000-0000-0000000000a2', 'gmail', 'b@example.test', 'g2', 'x', 'x', 'x', 'x', 'x', 'x', 's', now(), false);

select pg_temp.assert_true((select require_write_approval from public.user_mcp_connectors where name = 'new'), 'new MCP connector asks by default');
select pg_temp.assert_true(not (select require_write_approval from public.user_mcp_connectors where name = 'chosen off'), 'MCP connector created with false stays off');
select pg_temp.assert_true((select require_write_approval from public.user_google_drive_tokens where user_id = '00000000-0000-0000-0000-0000000000a1'), 'new Drive connection asks by default');
select pg_temp.assert_true(not (select require_write_approval from public.user_google_drive_tokens where user_id = '00000000-0000-0000-0000-0000000000a2'), 'Drive connection created with false stays off');
select pg_temp.assert_true((select require_write_approval from public.user_google_workspace_tokens where user_id = '00000000-0000-0000-0000-0000000000a1'), 'new Workspace connection asks by default');
select pg_temp.assert_true(not (select require_write_approval from public.user_google_workspace_tokens where user_id = '00000000-0000-0000-0000-0000000000a2'), 'Workspace connection created with false stays off');

-- 2. The migration, on a database as it was before it (default false, rows off).
alter table public.user_mcp_connectors alter column require_write_approval set default false;
alter table public.user_google_drive_tokens alter column require_write_approval set default false;
alter table public.user_google_workspace_tokens alter column require_write_approval set default false;
update public.user_mcp_connectors set require_write_approval = false;
update public.user_google_drive_tokens set require_write_approval = false;
update public.user_google_workspace_tokens set require_write_approval = false;

\ir ../migrations/20261126_95_litt_connectors_ask_before_writing.sql

select pg_temp.assert_true(
  (select bool_and(require_write_approval) from public.user_mcp_connectors)
  and (select bool_and(require_write_approval) from public.user_google_drive_tokens)
  and (select bool_and(require_write_approval) from public.user_google_workspace_tokens),
  'linked connectors are switched on');
select pg_temp.assert_true(
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and column_name = 'require_write_approval'
      and table_name in ('user_mcp_connectors', 'user_google_drive_tokens', 'user_google_workspace_tokens')
      and column_default = 'true'),
  'the migration sets the default');

-- A person turns it off again; running the migration again leaves that choice.
update public.user_mcp_connectors set require_write_approval = false where name = 'new';
update public.user_google_drive_tokens set require_write_approval = false where user_id = '00000000-0000-0000-0000-0000000000a1';
update public.user_google_workspace_tokens set require_write_approval = false where user_id = '00000000-0000-0000-0000-0000000000a1';

\ir ../migrations/20261126_95_litt_connectors_ask_before_writing.sql

select pg_temp.assert_true(
  not (select require_write_approval from public.user_mcp_connectors where name = 'new')
  and not (select require_write_approval from public.user_google_drive_tokens where user_id = '00000000-0000-0000-0000-0000000000a1')
  and not (select require_write_approval from public.user_google_workspace_tokens where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'a second run does not switch back on what a person turned off');

rollback;
\echo connectors ask before writing: ok

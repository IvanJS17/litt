-- Migration date: 2026-11-26
--
-- Connectors (MCP servers, Google Drive, Google Workspace) ask the person in
-- the conversation before they write (send, create, move, delete), by default.
-- The setting `require_write_approval` already exists on each connector table
-- and the person can still turn it off on a connector. This migration:
--
-- 1. makes `true` the default for new connectors, and
-- 2. switches it on for the connectors already linked.
--
-- Safe to re-run: each table is changed only while its default is still the
-- old `false`. Once the default is `true` the table is left alone, so a
-- connector a person turned off after this ran is not switched back on.
-- (schema.sql already declares the default `true`, and a fresh database lists
-- this file as applied.)
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_mcp_connectors',
    'user_google_drive_tokens',
    'user_google_workspace_tokens'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t
        and column_name = 'require_write_approval'
        and column_default = 'false'
    ) then
      execute format(
        'alter table public.%I alter column require_write_approval set default true', t);
      execute format(
        'update public.%I set require_write_approval = true where not require_write_approval', t);
    end if;
  end loop;
  -- It ends with the three defaults on, or it fails: it is never recorded as
  -- applied having left a connector table as it was.
  if (
    select count(*) from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid in (
        'public.user_mcp_connectors'::regclass,
        'public.user_google_drive_tokens'::regclass,
        'public.user_google_workspace_tokens'::regclass)
      and a.attname = 'require_write_approval'
      and pg_get_expr(d.adbin, d.adrelid) = 'true'
  ) <> 3 then
    raise exception 'require_write_approval does not default to true on every connector table';
  end if;
end;
$$;

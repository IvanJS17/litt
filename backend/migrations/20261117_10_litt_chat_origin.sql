-- Migration date: 2026-11-17
--
-- LiTT MCP server, layer 1 / slice 6: where a conversation was started.
--
-- A conversation a person starts from a connected app (Claude, ChatGPT,
-- Hermes...) is the same chats row as one started in LiTT; it appears in
-- the same history. These columns only say where it came from, so the history
-- can read "Desde Claude" and the connected-apps tab can list what each
-- connection started.
--
--   origin          'web' (the default, every existing row), 'word' or 'mcp'.
--   origin_grant_id the connection that started it. The connection can be
--                   removed later; the conversation stays, without the link.
--   origin_label    the app's name when it started the conversation, so the
--                   history keeps reading right after the connection is gone.
--
-- No policy changes: chats keeps the row-level security it has, and the new
-- columns are read and written by the backend with the service role.
-- Re-runnable: add column if not exists, create index if not exists.

alter table public.chats
  add column if not exists origin text not null default 'web',
  add column if not exists origin_grant_id uuid references public.mcp_grants(id) on delete set null,
  add column if not exists origin_label text;

alter table public.chats drop constraint if exists chats_origin_check;
alter table public.chats
  add constraint chats_origin_check check (origin in ('web', 'word', 'mcp'));

alter table public.chats drop constraint if exists chats_origin_label_length;
alter table public.chats
  add constraint chats_origin_label_length check (origin_label is null or char_length(origin_label) <= 120);

create index if not exists chats_origin_grant_idx
  on public.chats(origin_grant_id, created_at desc)
  where origin_grant_id is not null;

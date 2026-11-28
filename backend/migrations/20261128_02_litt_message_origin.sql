-- Migration date: 2026-11-28
--
-- A message a connected app (MCP) writes into a conversation carries a mark of
-- its own, stored with the message, so the person sees which messages came
-- through an app and the assistant is told which text did not come from them.
--
--   origin          'mcp' for a message a connected app wrote; null for every
--                   other message (typed in LiTT's web app or in Word).
--   origin_grant_id the connection that wrote it. The connection can be
--                   removed later; the message stays, without the link.
--   origin_label    the app's name when it wrote the message, so the
--                   conversation keeps reading right after the connection is gone.
--
-- Both message tables get the three columns: chat_messages (assistant and
-- matter conversations) and tabular_review_chat_messages (the threads of a
-- table review).
--
-- Existing rows: left null. Earlier messages cannot be told apart and are
-- not marked.
--
-- Locks: each table takes a brief ACCESS EXCLUSIVE lock for the column and
-- constraint changes, and the new check constraints and foreign key scan the
-- table once to validate; both tables are small today. Adding the nullable
-- columns rewrites no rows.
--
-- No policy or grant changes: the table keeps the row-level security and the
-- privileges it has; the new columns are read and written by the backend
-- with the service role. Safe to re-run: columns are added if not exists and
-- the constraints are dropped and recreated.

alter table public.chat_messages
  add column if not exists origin text,
  add column if not exists origin_grant_id uuid references public.mcp_grants(id) on delete set null,
  add column if not exists origin_label text;

alter table public.chat_messages drop constraint if exists chat_messages_origin_check;
alter table public.chat_messages
  add constraint chat_messages_origin_check check (origin is null or origin = 'mcp');

alter table public.chat_messages drop constraint if exists chat_messages_origin_label_length;
alter table public.chat_messages
  add constraint chat_messages_origin_label_length check (origin_label is null or char_length(origin_label) <= 120);

alter table public.tabular_review_chat_messages
  add column if not exists origin text,
  add column if not exists origin_grant_id uuid references public.mcp_grants(id) on delete set null,
  add column if not exists origin_label text;

alter table public.tabular_review_chat_messages drop constraint if exists tabular_review_chat_messages_origin_check;
alter table public.tabular_review_chat_messages
  add constraint tabular_review_chat_messages_origin_check check (origin is null or origin = 'mcp');

alter table public.tabular_review_chat_messages drop constraint if exists tabular_review_chat_messages_origin_label_length;
alter table public.tabular_review_chat_messages
  add constraint tabular_review_chat_messages_origin_label_length check (origin_label is null or char_length(origin_label) <= 120);

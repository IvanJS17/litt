-- Migration date: 2026-10-23
--
-- Governed BYOK for the other two conversation tables (LiTT sync 2026-10-23,
-- S3; ledger §16.3 "Provider catalog, credentials and model selection" and
-- "Chat turns, server runs and two chats"). Word add-in chats and tabular
-- review chats are conversations too: each is fixed to the provider + model +
-- credential it was created with, exactly like public.chats
-- (20261023_15_litt_pinned_chat_route.sql). The consistency checks are NOT
-- VALID so rows written before this migration survive; they are pinned on
-- their next turn. Every new or updated row is checked.
--
-- Re-runnable: add column if not exists, drop-before-create for constraints.

alter table public.word_chats add column if not exists model_provider text;
alter table public.word_chats add column if not exists credential_ref text;
alter table public.word_chats drop constraint if exists word_chats_model_route_consistent;
alter table public.word_chats add constraint word_chats_model_route_consistent check (
  (model_provider is null and credential_ref is null)
  or (model_provider is not null and model is not null and credential_ref is not null
      and btrim(credential_ref) <> '')
) not valid;

alter table public.tabular_review_chats add column if not exists model_provider text;
alter table public.tabular_review_chats add column if not exists credential_ref text;
alter table public.tabular_review_chats drop constraint if exists tabular_review_chats_model_route_consistent;
alter table public.tabular_review_chats add constraint tabular_review_chats_model_route_consistent check (
  (model_provider is null and credential_ref is null)
  or (model_provider is not null and model is not null and credential_ref is not null
      and btrim(credential_ref) <> '')
) not valid;

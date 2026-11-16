-- Migration date: 2026-11-16
--
-- Citation support check, wider scope (docs/citation-support-check.md). The
-- silent check also covers the citations of tabular review cells, of the
-- tabular review chat and of the source quotes of playbook drafts. Same table,
-- same rules: references and numbers only, no text, no person, and the result
-- goes with the row it belongs to.
--
-- 1. Three more owners, each nullable and each deleted with the owner:
--    tabular_cell_id (tabular_cells), tabular_chat_message_id
--    (tabular_review_chat_messages), playbook_id (playbooks, the draft).
--    Which path a row came from is the owner column that is set; no `source`
--    column.
-- 2. The two-way "one message" check becomes "exactly one owner".
-- 3. One partial unique index per new owner, like the existing two.
-- 4. service_role may also delete: a tabular cell is regenerated in place (same
--    row, new content), so the check of its previous content is removed before
--    the new one is written instead of staying behind as a stale result.
--
-- Re-runnable: columns and indexes use if not exists; the constraints, the
-- grant and the policy are dropped or replaced before they are created.

alter table public.citation_support_checks
  add column if not exists tabular_cell_id uuid
    references public.tabular_cells(id) on delete cascade,
  add column if not exists tabular_chat_message_id uuid
    references public.tabular_review_chat_messages(id) on delete cascade,
  add column if not exists playbook_id uuid
    references public.playbooks(id) on delete cascade;

alter table public.citation_support_checks
  drop constraint if exists citation_support_checks_one_message;
alter table public.citation_support_checks
  drop constraint if exists citation_support_checks_one_owner;
alter table public.citation_support_checks
  add constraint citation_support_checks_one_owner
    check (num_nonnulls(message_id, word_message_id, tabular_cell_id,
                        tabular_chat_message_id, playbook_id) = 1);

create unique index if not exists citation_support_checks_cell_once
  on public.citation_support_checks (tabular_cell_id, citation_ref, question_version)
  where tabular_cell_id is not null;
create unique index if not exists citation_support_checks_tabular_chat_once
  on public.citation_support_checks (tabular_chat_message_id, citation_ref, question_version)
  where tabular_chat_message_id is not null;
create unique index if not exists citation_support_checks_playbook_once
  on public.citation_support_checks (playbook_id, citation_ref, question_version)
  where playbook_id is not null;

grant select, insert, delete on public.citation_support_checks to service_role;
drop policy if exists citation_support_checks_service_delete on public.citation_support_checks;
create policy citation_support_checks_service_delete on public.citation_support_checks
  for delete to service_role using (true);

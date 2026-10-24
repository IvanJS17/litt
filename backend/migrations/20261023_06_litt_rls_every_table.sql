-- Migration date: 2026-10-23
--
-- Row-level security on every application table (LiTT sync 2026-10-23, S1).
-- Residue of LiTT 20260905_01_recovery_core_convergence once its re-issue of
-- upstream tables is dropped: LiTT keeps RLS enabled on every relation as
-- defense in depth. The backend uses service_role, which bypasses RLS, and
-- browser roles hold no grants on these tables, so enabling RLS without
-- policies changes no backend behaviour; it only removes the window in which
-- a stray browser grant would expose a table.
--
-- These are the upstream tables that still had RLS disabled at e7ab6bd4.
-- Re-runnable: enabling RLS twice is a no-op.

alter table public.chat_messages enable row level security;
alter table public.chats enable row level security;
alter table public.document_edits enable row level security;
alter table public.document_versions enable row level security;
alter table public.documents enable row level security;
alter table public.hidden_workflows enable row level security;
alter table public.library_folders enable row level security;
alter table public.mike_workflow_assets enable row level security;
alter table public.mike_workflows enable row level security;
alter table public.project_subfolders enable row level security;
alter table public.projects enable row level security;
alter table public.tabular_cells enable row level security;
alter table public.tabular_review_chat_messages enable row level security;
alter table public.tabular_review_chats enable row level security;
alter table public.tabular_reviews enable row level security;
alter table public.user_profiles enable row level security;
alter table public.workflow_addons enable row level security;
alter table public.workflow_shares enable row level security;
alter table public.workflows enable row level security;

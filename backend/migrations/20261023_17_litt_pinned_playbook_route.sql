-- Migration date: 2026-10-23
--
-- Governed BYOK for playbook work (LiTT sync 2026-10-23, S3; ledger §16.3
-- "Workflow catalog, add-ons and playbooks"): a playbook review and a
-- playbook import are fixed, when requested, to one provider + model +
-- credential, recorded on their row, and the work that runs later uses
-- exactly that route. Rows written before this migration carry no route; a
-- queued review or import without one is refused instead of being resolved
-- again. The consistency checks are NOT VALID for the same reason.
--
-- Re-runnable: add column if not exists, drop-before-create for constraints.

alter table public.playbook_runs add column if not exists model_provider text;
alter table public.playbook_runs add column if not exists credential_ref text;
alter table public.playbook_runs drop constraint if exists playbook_runs_model_route_consistent;
alter table public.playbook_runs add constraint playbook_runs_model_route_consistent check (
  (model_provider is null and credential_ref is null)
  or (model_provider is not null and credential_ref is not null
      and btrim(credential_ref) <> '')
) not valid;

alter table public.playbook_imports add column if not exists model_provider text;
alter table public.playbook_imports add column if not exists credential_ref text;
alter table public.playbook_imports drop constraint if exists playbook_imports_model_route_consistent;
alter table public.playbook_imports add constraint playbook_imports_model_route_consistent check (
  (model_provider is null and credential_ref is null)
  or (model_provider is not null and credential_ref is not null
      and btrim(credential_ref) <> '')
) not valid;

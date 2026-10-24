-- Migration date: 2026-10-23
--
-- Audit is insert-only (LiTT sync 2026-10-23, S1; condition C3 of
-- docs/UPSTREAM_SYNC_PLAN.md §3). LiTT keeps upstream's audit_events shape
-- (user_id, org_id, action, detail) so every upstream writer keeps working,
-- and restores LiTT's guarantee that a recorded event is never changed or
-- removed:
--
--   * audit_events_insert_only rejects every UPDATE and DELETE, including
--     upstream's account-cleanup rewrite and deletion of audit rows. With it,
--     deleting an account that has audit history fails closed until the
--     retention decision (TD-008) defines what may be anonymized.
--   * audit_event_org fixes the organization attribution when the row is
--     inserted; it no longer runs on UPDATE, which this table no longer
--     allows anyway.
--
-- AI evidence relations are already insert-only (20261023_03).
-- Re-runnable: create or replace, drop-before-create triggers.

create or replace function public.audit_events_insert_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_events is insert-only; % is not allowed', tg_op
    using errcode = '55000';
end;
$$;

revoke all on function public.audit_events_insert_only() from public, anon, authenticated;

drop trigger if exists audit_events_insert_only_trigger on public.audit_events;
create trigger audit_events_insert_only_trigger
  before update or delete on public.audit_events
  for each row execute function public.audit_events_insert_only();

drop trigger if exists audit_event_org on public.audit_events;
create trigger audit_event_org before insert on public.audit_events
  for each row execute function public.audit_event_org();

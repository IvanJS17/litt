-- Migration date: 2026-11-07
--
-- LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Using a
-- playbook as a starting point"): the guards the T3 review asked for.
--
-- 1. One proposal at a time per copy. A unique partial index on the running
--    'proposal' rows of public.playbook_imports, so two requests that both
--    passed the backend's checks cannot both start one: the second insert
--    is refused (23505) and answered as playbook_proposals_running. The
--    backend ends a proposal that will never finish (silent and jobless)
--    before it starts a new one, so the index never holds a copy forever.
-- 2. accept_playbook_change: accepting a change in one transaction. It locks
--    the playbook row (the row marking the playbook ready writes), checks the
--    version the backend read, claims the change and writes the new rules.
--    A change is never accepted without its rules being saved, so marking
--    the playbook ready, which refuses pending changes and writes only over
--    the version it read, cannot interleave with it and leave a ready
--    playbook with a pending change.
-- 3. discard_playbook_proposal_sources: a failed proposal's reference
--    documents go only while the copy is still a draft, under the same row
--    lock, and only the rows this call deleted are returned, so the backend
--    removes no stored file of a ready playbook or of another playbook.
--
-- Both functions are backend-only (service_role), like the playbook tables.
-- Safe to re-run: create ... if not exists, create or replace.

create unique index if not exists idx_playbook_imports_one_running_proposal
  on public.playbook_imports(playbook_id)
  where status = 'running' and kind = 'proposal';

create or replace function public.accept_playbook_change(
  p_playbook_id uuid,
  p_change_id uuid,
  p_user_id uuid,
  p_read_updated_at timestamptz,
  p_content jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version timestamptz;
begin
  select updated_at into current_version
  from public.playbooks
  where id = p_playbook_id
  for update;
  if not found then return 'missing'; end if;
  -- Another write landed since the backend read the rules.
  if current_version is distinct from p_read_updated_at then return 'stale'; end if;
  update public.playbook_changes
  set status = 'accepted', decided_by = p_user_id, decided_at = now()
  where id = p_change_id and playbook_id = p_playbook_id and status = 'pending';
  if not found then return 'decided'; end if;
  update public.playbooks
  set content_json = p_content, updated_at = clock_timestamp()
  where id = p_playbook_id;
  return 'accepted';
end;
$$;

create or replace function public.discard_playbook_proposal_sources(
  p_playbook_id uuid,
  p_source_ids uuid[]
)
returns setof text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.playbooks
  where id = p_playbook_id and status = 'draft'
  for update;
  -- A ready playbook (or one already gone) keeps its documents.
  if not found then return; end if;
  return query
    delete from public.playbook_sources
    where playbook_id = p_playbook_id and id = any(p_source_ids)
    returning storage_key;
end;
$$;

revoke all on function public.accept_playbook_change(uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.accept_playbook_change(uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;
revoke all on function public.discard_playbook_proposal_sources(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.discard_playbook_proposal_sources(uuid, uuid[])
  to service_role;

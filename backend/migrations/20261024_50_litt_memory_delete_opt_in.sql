-- Migration date: 2026-10-24
--
-- LiTT (cycle 2026-10-24, ledger 16.3 "Private memory boundary").
-- Upstream 20261024_02_workspace_scoped_data_deletion replaces
-- delete_user_private_memories(uuid) with a workspace-scoped
-- delete_user_private_memories(uuid, uuid). Its Personal branch creates a
-- missing Personal memory file switched ON; LiTT memory is opt-in
-- (20261023_09_litt_memory_opt_in), so the file starts OFF here. The
-- workspace scoping is upstream's, unchanged. The one-argument overload
-- stays dropped.
--
-- Safe to re-run: drop if exists, create or replace, revoke before grant.

drop function if exists public.delete_user_private_memories(uuid);
create or replace function public.delete_user_private_memories(
  p_user_id uuid,
  p_org_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
  deleted_projects integer := 0;
begin
  if p_org_id is not null then
    -- One file per person per workspace; none for a non-member, since the
    -- file is tied to the membership.
    for target in
      select file.id
      from public.memory_files file
      where file.scope = 'user'
        and file.user_id = p_user_id
        and file.org_id = p_org_id
    loop
      perform public.wipe_memory_file(target.id, null, p_user_id, 'wipe');
    end loop;
    return 0;
  end if;

  -- Lock the caller's own private projects rather than the whole table.
  -- FOR UPDATE on a project row blocks both a move into an organization (an
  -- UPDATE of that row) and a new access grant (the grant's foreign key takes
  -- KEY SHARE on the project, which FOR UPDATE excludes), so eligibility
  -- cannot change between this check and the wipe. A table-level SHARE lock
  -- did the same job by stalling every project write in the system for as
  -- long as this user's files took to wipe.
  perform project.id from public.projects project
  where project.user_id = p_user_id and project.org_id is null
  order by project.id
  for update;

  -- LiTT: memory is opt-in (20261023_09_litt_memory_opt_in), so a file
  -- created here starts off.
  insert into public.memory_files(scope, user_id, enabled)
  values ('user', p_user_id, false)
  on conflict do nothing;

  for target in
    select eligible.id, eligible.scope
    from (
      -- The person's Personal memory. Their memory in each organization is
      -- that workspace's, deleted from it.
      select file.id, file.scope
      from public.memory_files file
      where file.scope = 'user'
        and file.user_id = p_user_id
        and file.org_id is null
      union all
      select file.id, file.scope
      from public.memory_files file
      join public.projects project on project.id = file.project_id
      where file.scope = 'project'
        and project.user_id = p_user_id
        and project.org_id is null
        and not exists (
          select 1 from public.project_access_grants grant_row
          where grant_row.project_id = project.id
        )
    ) eligible
    order by eligible.id
  loop
    perform public.wipe_memory_file(target.id, null, p_user_id, 'wipe');
    if target.scope = 'project' then
      deleted_projects := deleted_projects + 1;
    end if;
  end loop;

  return deleted_projects;
end;
$$;

revoke all on function public.delete_user_private_memories(uuid, uuid)
  from public, anon, authenticated;
grant execute
  on function public.delete_user_private_memories(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

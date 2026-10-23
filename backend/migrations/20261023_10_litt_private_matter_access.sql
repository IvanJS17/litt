-- Migration date: 2026-10-23
--
-- Private matters in SQL (LiTT sync 2026-10-23, S1; condition C2 of
-- docs/UPSTREAM_SYNC_PLAN.md §3). Organization owners and admins have no
-- standing access to private matters, and the SQL mirror of project access
-- enforces matter privacy, not only the TypeScript resolver.
--
-- 1. project_private_matter_denied(project, user) is true when the project is
--    bound to a private matter and the user has no active membership of that
--    matter while still a member of its organization. A null user is denied.
-- 2. project_access_role keeps upstream's body unchanged and evaluates that
--    gate first, so the creator, an organization owner, upstream's
--    "ownerless" takeover, organization visibility and the administrative
--    private-content path all yield no role on a private matter. Chats,
--    reviews and documents inside a project resolve through this function.
-- 3. project_access_scope labels a private matter's project 'private'.
-- 4. can_access_org_private_content always answers false: upstream's
--    owner/admin access to members' private content is not part of LiTT
--    (plan §4.2), so org_private_access_role, org_private_document_access and
--    list_org_private_content grant and list nothing.
--
-- Re-runnable: create or replace.

create or replace function public.project_private_matter_denied(
  p_project_id uuid,
  p_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matters mt
    where mt.project_id = p_project_id
      and mt.visibility = 'private'
      and not exists (
        select 1
        from public.matter_memberships mm
        join public.workspaces w on w.id = mt.workspace_id
        join public.org_members m
          on m.org_id = w.organization_id and m.user_id = mm.user_id
        where mm.matter_id = mt.id
          and mm.user_id::text = p_user_id
          and mm.status = 'active'
      )
  );
$$;

revoke all on function public.project_private_matter_denied(uuid, text)
  from public, anon, authenticated;
grant execute on function public.project_private_matter_denied(uuid, text)
  to service_role;

create or replace function public.project_access_role(
  p_project_id uuid,
  p_project_user_id uuid,
  p_org_id uuid,
  p_user_id text,
  p_user_email text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- LiTT C2: a project bound to a private matter is invisible to
    -- everyone without an active membership of that matter, before
    -- any upstream branch (creator, organization owner, ownerless,
    -- organization visibility, administrative private access).
    when public.project_private_matter_denied(p_project_id, p_user_id) then null
    else coalesce((case
    when not public.org_is_active(p_org_id) then null
    when exists(select 1 from public.projects where id=p_project_id and archived_at is not null) then null
    when p_org_id is not null then (
      select case
        when p_project_user_id::text = p_user_id then 'owner'
        -- An organization owner owns what is public, and what has no Owner
        -- left. A private item with an Owner is not theirs unless shared.
        when m.role = 'owner' and (
          (
            select project.visibility from public.projects project
            where project.id = p_project_id
          ) = 'organization'
          or public.project_is_ownerless(
            p_project_id, p_project_user_id, p_org_id
          )
        ) then 'owner'
        when o.role = 'deny' then null
        when o.role in ('owner', 'editor', 'viewer') then o.role
        when (
          select project.visibility from public.projects project
          where project.id = p_project_id
        ) = 'organization' then 'editor'
        else null
      end
      from public.org_members m
      left join public.project_org_access_overrides o
        on o.project_id = p_project_id
       and o.org_id = p_org_id
       and o.user_id = m.user_id
      where m.org_id = p_org_id and m.user_id::text = p_user_id
    )
    when p_project_user_id::text = p_user_id then 'owner'
    else (
      select g.role from public.project_access_grants g
      where g.project_id = p_project_id
        and coalesce(p_user_email, '') <> ''
        and g.email = lower(p_user_email)
      limit 1
    )
  end), public.org_private_access_role(p_org_id,'project',p_project_id,p_user_id))
  end;
$$;

create or replace function public.project_access_scope(
  p_project_id uuid,
  p_org_id uuid,
  p_visibility text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- LiTT C2: a private matter's project is private whatever its own
    -- visibility says; its team is the matter membership.
    when exists (
      select 1 from public.matters mt
      where mt.project_id = p_project_id and mt.visibility = 'private'
    ) then 'private'
    when p_org_id is not null and p_visibility = 'organization'
      then 'organization'
    when p_org_id is not null and exists (
      select 1 from public.project_org_access_overrides o
      where o.project_id = p_project_id and o.role <> 'deny'
    ) then 'shared'
    when p_org_id is null and exists (
      select 1 from public.project_access_grants g
      where g.project_id = p_project_id
    ) then 'shared'
    else 'private'
  end;
$$;

create or replace function public.can_access_org_private_content(p_org_id uuid,p_user_id uuid)
returns boolean language sql stable set search_path=public,pg_temp as $$
  -- LiTT: no standing owner/admin access to private content (plan §4.2, C2).
  select false;
$$;

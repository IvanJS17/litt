-- Migration date: 2026-11-07
--
-- LiTT adaptation of upstream 20261101_03_member_lookup_by_uuid (upstream
-- cycle 4 of 10, pin 31539729). Upstream rewrites project_access_role so the
-- membership lookup compares the native uuid (S2), but its text copies the
-- access ladder without LiTT's private-matter guard:
--
--   * C2 (20261023_10): a project bound to a private matter is invisible to
--     everyone without an active membership of that matter, before any
--     upstream branch.
--
-- This migration re-creates the function with that guard as its first
-- branch; the rest is upstream's text. It runs after 20261101_03 in filename
-- order on fresh and existing databases alike.
-- backend/src/__tests__/sql/performance.litt-private-matters.sql proves the
-- guard through every list and verdict that calls this function.
--
-- Safe to re-run: create or replace, same signature.

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
      where m.org_id = p_org_id and m.user_id = (case when p_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end)
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

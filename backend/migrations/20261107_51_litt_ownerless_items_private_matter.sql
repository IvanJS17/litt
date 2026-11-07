-- Migration date: 2026-11-07
--
-- LiTT adaptation of upstream 20261101_17_ownerless_items_set_based (upstream
-- cycle 5 of 10, pin d0a7ca75). Upstream rewrites ownerless_org_item_ids as
-- anti-joins instead of calling project_is_ownerless / workflow_is_ownerless
-- per item. The inlined project conditions are upstream's, without the
-- private-matter rule LiTT adds to project_is_ownerless
-- (20261023_13_litt_private_matter_lists, C2):
--
--   * a project bound to a matter is never "ownerless": an organization owner
--     does not take it over when its creator leaves the organization.
--
-- This migration re-creates the function from upstream's text with that
-- condition, so the set-based list and the per-item function agree again.
-- backend/src/__tests__/sql/performance.litt-private-matters.sql proves it.
-- Control 5 in performance.litt-private-matters-controls.sql proves
-- upstream's text alone would list the matter project.
--
-- Safe to re-run: create or replace, same signature.

create or replace function public.ownerless_org_item_ids(p_org_ids uuid[])
returns table (kind text, item_id uuid)
language sql
stable
set search_path = public
as $$
  -- project_is_ownerless / workflow_is_ownerless, written as anti-joins so
  -- the planner evaluates them for the whole set at once instead of calling
  -- a function (three subqueries) per private item. Keep the conditions in
  -- step with those functions: not archived, creator no longer a member of
  -- the item's organization, and no 'owner' override (and, for projects,
  -- LiTT's matter exclusion).
  select 'project'::text, p.id
  from public.projects p
  where p.org_id = any(p_org_ids)
    and p.visibility <> 'organization'
    and p.archived_at is null
    -- LiTT C2, as in project_is_ownerless: a matter's project belongs to the
    -- matter team, never to the organization's owners, whoever created it.
    and not exists (select 1 from public.matters mt where mt.project_id = p.id)
    and not exists (
      select 1 from public.org_members creator
      where creator.org_id = p.org_id and creator.user_id = p.user_id
    )
    and not exists (
      select 1 from public.project_org_access_overrides o
      where o.project_id = p.id and o.role = 'owner'
    )
  union all
  select 'workflow'::text, w.id
  from public.workflows w
  where w.org_id = any(p_org_ids)
    and w.visibility <> 'organization'
    and w.archived_at is null
    and not exists (
      select 1 from public.org_members creator
      where creator.org_id = w.org_id and creator.user_id = w.user_id
    )
    and not exists (
      select 1 from public.workflow_org_access_overrides o
      where o.workflow_id = w.id and o.role = 'owner'
    );
$$;
revoke all on function public.ownerless_org_item_ids(uuid[])
  from public, anon, authenticated;
grant execute on function public.ownerless_org_item_ids(uuid[])
  to service_role;

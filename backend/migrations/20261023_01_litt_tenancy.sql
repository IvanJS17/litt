-- Migration date: 2026-10-23
--
-- LiTT tenancy on top of upstream organizations (LiTT sync 2026-10-23, S1).
-- Port of LiTT 20260831_01_recovery_identity_tenancy, re-authored against
-- upstream's organization model instead of LiTT's former
-- organization_memberships table:
--
--   * Organization membership is upstream's org_members (owner|admin|member).
--     LiTT's org-level vocabulary maps org_owner -> owner and
--     workspace_admin -> admin. A membership is revoked by deleting its row,
--     so there is no membership status at organization level.
--   * Workspaces are internal units of one firm (decision D1(b) in
--     docs/UPSTREAM_SYNC_PLAN.md §3.1) and matters are the unit of privacy.
--     Both stay LiTT tables with their own memberships and status.
--   * A matter belongs to at most one project and a project to at most one
--     matter (matters_project_id_unique).
--   * Browser roles read the six tenancy relations only through the
--     SELECT-only policies below; every mutation is backend-mediated.
--   * organizations.authorization_epoch advances once per authorization
--     change: insert, update and DELETE of org_members, workspace_memberships
--     and matter_memberships, and a change of a matter's visibility, workspace
--     or project. Upstream revokes by deleting rows, so DELETE is covered.
--
-- Re-runnable: add column / create table / create index if not exists,
-- create or replace functions, drop-before-create policies and triggers.

alter table public.organizations
  add column if not exists authorization_epoch bigint not null default 0;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_organization_idx
  on public.workspaces(organization_id);
alter table public.workspaces enable row level security;

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (
    role in ('workspace_admin', 'editor', 'viewer', 'technical_operator')
  ),
  status text not null default 'active' check (
    status in ('active', 'inactive', 'revoked')
  ),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships(user_id);
alter table public.workspace_memberships enable row level security;

create table if not exists public.matters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null,
  cm_number text,
  practice text,
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists matters_project_id_unique
  on public.matters(project_id)
  where project_id is not null;
create index if not exists matters_workspace_idx
  on public.matters(workspace_id);
alter table public.matters enable row level security;

create table if not exists public.matter_memberships (
  matter_id uuid not null references public.matters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (
    role in ('matter_owner', 'editor', 'viewer', 'technical_operator')
  ),
  status text not null default 'active' check (
    status in ('active', 'inactive', 'revoked')
  ),
  created_at timestamptz not null default now(),
  primary key (matter_id, user_id)
);
create index if not exists matter_memberships_user_idx
  on public.matter_memberships(user_id);
alter table public.matter_memberships enable row level security;

-- ---------------------------------------------------------------------------
-- RLS helpers: security definer, fixed search_path, auth.uid() internally.
-- ---------------------------------------------------------------------------

create or replace function public.organization_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.org_members m
  where m.org_id = p_org and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_organization_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

-- An organization owner or admin administers the firm's workspaces. That is
-- not access to matters: matter content needs an explicit matter membership.
create or replace function public.is_workspace_admin(p_ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.org_members m on m.org_id = w.organization_id
    where w.id = p_ws
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.matters_select_visible(p_matter uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matters mt
    join public.workspaces w on w.id = mt.workspace_id
    join public.org_members m
      on m.org_id = w.organization_id and m.user_id = auth.uid()
    where mt.id = p_matter
      and mt.visibility = 'public'
  );
$$;

-- A matter role needs an active matter membership AND a current organization
-- membership, so removing someone from the organization takes effect at once
-- even if a matter_memberships row remains.
create or replace function public.matter_role(p_matter uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select mm.role
  from public.matter_memberships mm
  join public.matters mt on mt.id = mm.matter_id
  join public.workspaces w on w.id = mt.workspace_id
  join public.org_members m
    on m.org_id = w.organization_id and m.user_id = auth.uid()
  where mm.matter_id = p_matter
    and mm.user_id = auth.uid()
    and mm.status = 'active'
  limit 1;
$$;

revoke execute on function public.organization_role(uuid) from public, anon, authenticated;
revoke execute on function public.is_organization_member(uuid) from public, anon, authenticated;
revoke execute on function public.is_workspace_admin(uuid) from public, anon, authenticated;
revoke execute on function public.matters_select_visible(uuid) from public, anon, authenticated;
revoke execute on function public.matter_role(uuid) from public, anon, authenticated;
grant execute on function public.organization_role(uuid) to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.matters_select_visible(uuid) to authenticated;
grant execute on function public.matter_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Six SELECT-only tenancy policies. No browser DML policy exists.
-- ---------------------------------------------------------------------------

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations for select
  using (public.is_organization_member(id));

drop policy if exists org_members_select_member on public.org_members;
create policy org_members_select_member
  on public.org_members for select
  using (user_id = auth.uid() or public.organization_role(org_id) = 'owner');

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
  on public.workspaces for select
  using (public.is_organization_member(organization_id));

drop policy if exists workspace_memberships_select_member on public.workspace_memberships;
create policy workspace_memberships_select_member
  on public.workspace_memberships for select
  using (user_id = auth.uid() or public.is_workspace_admin(workspace_id));

drop policy if exists matters_select_member on public.matters;
create policy matters_select_member
  on public.matters for select
  using (public.matter_role(id) is not null or public.matters_select_visible(id));

drop policy if exists matter_memberships_select_member on public.matter_memberships;
create policy matter_memberships_select_member
  on public.matter_memberships for select
  using (public.matter_role(matter_id) is not null);

revoke all on public.organizations, public.org_members, public.workspaces,
  public.workspace_memberships, public.matters, public.matter_memberships
  from anon, authenticated;
grant select on public.organizations, public.org_members, public.workspaces,
  public.workspace_memberships, public.matters, public.matter_memberships
  to authenticated;
grant select, insert, update, delete on public.workspaces,
  public.workspace_memberships, public.matters, public.matter_memberships
  to service_role;

-- ---------------------------------------------------------------------------
-- Authorization epoch: bump_authorization_epoch is the single increment
-- site; row triggers call it for the owning organization.
-- ---------------------------------------------------------------------------

create or replace function public.bump_authorization_epoch(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.organizations
  set authorization_epoch = authorization_epoch + 1
  where id = p_org;
$$;

create or replace function public.bump_epoch_for_org_member_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.org_id, new.user_id, new.role, new.can_access_private_content)
         is not distinct from
         (old.org_id, old.user_id, old.role, old.can_access_private_content) then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.bump_authorization_epoch(old.org_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.org_id is distinct from old.org_id) then
    perform public.bump_authorization_epoch(new.org_id);
  end if;
  return null;
end;
$$;

create or replace function public.bump_epoch_for_workspace_membership_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.workspace_id, new.user_id, new.role, new.status)
         is not distinct from
         (old.workspace_id, old.user_id, old.role, old.status) then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.bump_authorization_epoch(w.organization_id)
    from public.workspaces w where w.id = old.workspace_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id) then
    perform public.bump_authorization_epoch(w.organization_id)
    from public.workspaces w where w.id = new.workspace_id;
  end if;
  return null;
end;
$$;

create or replace function public.bump_epoch_for_matter_membership_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.matter_id, new.user_id, new.role, new.status)
         is not distinct from
         (old.matter_id, old.user_id, old.role, old.status) then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.bump_authorization_epoch(w.organization_id)
    from public.matters mt join public.workspaces w on w.id = mt.workspace_id
    where mt.id = old.matter_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.matter_id is distinct from old.matter_id) then
    perform public.bump_authorization_epoch(w.organization_id)
    from public.matters mt join public.workspaces w on w.id = mt.workspace_id
    where mt.id = new.matter_id;
  end if;
  return null;
end;
$$;

-- Making a matter public, moving it, or re-pointing its project changes who
-- may read it; deleting it ends every grant it carried.
create or replace function public.bump_epoch_for_matter_scope_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.workspace_id, new.project_id, new.visibility)
         is not distinct from
         (old.workspace_id, old.project_id, old.visibility) then
    return null;
  end if;
  perform public.bump_authorization_epoch(w.organization_id)
  from public.workspaces w where w.id = old.workspace_id;
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    perform public.bump_authorization_epoch(w.organization_id)
    from public.workspaces w where w.id = new.workspace_id;
  end if;
  return null;
end;
$$;

drop trigger if exists org_members_epoch_bump on public.org_members;
create trigger org_members_epoch_bump
  after insert or update or delete on public.org_members
  for each row execute function public.bump_epoch_for_org_member_mutation();

drop trigger if exists workspace_memberships_epoch_bump on public.workspace_memberships;
create trigger workspace_memberships_epoch_bump
  after insert or update or delete on public.workspace_memberships
  for each row execute function public.bump_epoch_for_workspace_membership_mutation();

drop trigger if exists matter_memberships_epoch_bump on public.matter_memberships;
create trigger matter_memberships_epoch_bump
  after insert or update or delete on public.matter_memberships
  for each row execute function public.bump_epoch_for_matter_membership_mutation();

drop trigger if exists matters_epoch_bump on public.matters;
create trigger matters_epoch_bump
  after update or delete on public.matters
  for each row execute function public.bump_epoch_for_matter_scope_mutation();

revoke execute on function public.bump_authorization_epoch(uuid) from public, anon, authenticated;
grant execute on function public.bump_authorization_epoch(uuid) to service_role;
revoke execute on function public.bump_epoch_for_org_member_mutation() from public, anon, authenticated;
revoke execute on function public.bump_epoch_for_workspace_membership_mutation() from public, anon, authenticated;
revoke execute on function public.bump_epoch_for_matter_membership_mutation() from public, anon, authenticated;
revoke execute on function public.bump_epoch_for_matter_scope_mutation() from public, anon, authenticated;

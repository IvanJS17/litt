-- Migration date: 2026-11-19
--
-- Playbooks linked to the firm's request types (docs/matter-requests.md,
-- "Playbooks suggested for a type"; Donna triage, slice P1).
--
-- A type of the firm's catalog (matter_request_types) may have several
-- playbooks linked, and a playbook several types. Only a playbook that is
-- ready and shared with the whole firm can be linked, and only to a type of
-- the same firm. A person (an owner or admin of the firm) links; nothing here
-- is written by a model.
--
-- request_type_playbooks: one row per link. Nothing is ever deleted: unlinking
-- marks the row (unlinked_at, unlinked_by) and linking again later writes a new
-- row, so the history of who linked and unlinked what stays. At most one open
-- link exists per type and playbook. The actor columns and playbook_id have no
-- foreign key (erasing an account or a playbook is never blocked by a link; a
-- link to a playbook that is gone or no longer shared simply reads as absent).
--
-- Re-runnable: tables and indexes use if not exists, triggers and policies are
-- dropped before they are created, functions use create or replace, grants are
-- idempotent.

create table if not exists public.request_type_playbooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  type_id uuid not null references public.matter_request_types(id) on delete restrict,
  playbook_id uuid not null,
  linked_by uuid,
  linked_at timestamptz not null default now(),
  unlinked_by uuid,
  unlinked_at timestamptz,
  constraint request_type_playbooks_unlinked_marked
    check (unlinked_by is null or unlinked_at is not null)
);
create unique index if not exists request_type_playbooks_open_idx
  on public.request_type_playbooks (type_id, playbook_id)
  where unlinked_at is null;
create index if not exists request_type_playbooks_org_type_idx
  on public.request_type_playbooks (org_id, type_id, linked_at, id);
create index if not exists request_type_playbooks_playbook_idx
  on public.request_type_playbooks (playbook_id);

-- Same firm and ready, checked by the database as well as the backend: the
-- type and the playbook belong to org_id, the playbook is ready and shared with
-- the organization. After that only the unlinking mark may change, once.
create or replace function public.request_type_playbooks_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'request_type_playbooks keeps its history; delete is not allowed'
      using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    if new.unlinked_at is not null or new.unlinked_by is not null then
      raise exception 'a link starts open' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.matter_request_types t
      where t.id = new.type_id and t.organization_id = new.org_id
    ) then
      raise exception 'the request type belongs to another firm' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.playbooks p
      where p.id = new.playbook_id
        and p.org_id = new.org_id
        and p.visibility = 'organization'
        and p.status = 'ready'
    ) then
      raise exception 'only a ready playbook shared with the same firm can be linked'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.unlinked_at is not null
     or new.unlinked_at is null
     or new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.type_id is distinct from old.type_id
     or new.playbook_id is distinct from old.playbook_id
     or new.linked_by is distinct from old.linked_by
     or new.linked_at is distinct from old.linked_at then
    raise exception 'a link only changes by being unlinked, once' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.request_type_playbooks_guard() from public, anon, authenticated;

drop trigger if exists request_type_playbooks_guard_trigger on public.request_type_playbooks;
create trigger request_type_playbooks_guard_trigger
  before insert or update or delete on public.request_type_playbooks
  for each row execute function public.request_type_playbooks_guard();

-- ---------------------------------------------------------------------------
-- RLS: read by the firm's members (like the catalog); every write is the
-- backend's (service_role), which authorizes it explicitly.
-- ---------------------------------------------------------------------------
alter table public.request_type_playbooks enable row level security;

revoke all on public.request_type_playbooks from public, anon, authenticated;
grant select on public.request_type_playbooks to authenticated;
grant select, insert, update on public.request_type_playbooks to service_role;

drop policy if exists request_type_playbooks_select_member on public.request_type_playbooks;
create policy request_type_playbooks_select_member on public.request_type_playbooks
  for select to authenticated using (public.is_organization_member(org_id));

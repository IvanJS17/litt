-- Migration date: 2026-10-23
--
-- No organization deletion or purge (LiTT sync 2026-10-23, S1; conditions C3
-- and C5 of docs/UPSTREAM_SYNC_PLAN.md §3). Upstream soft-deletes a team
-- organization and purges it, with its projects, workflows, documents,
-- reviews, chats and memory, 30 days later. LiTT has no retention decision
-- yet (TD-008), so a firm's organization is never deleted:
--
--   * soft_delete_organization raises feature_not_supported; the API keeps
--     answering 405 (S2).
--   * purge_expired_organizations purges nothing and reports 0, so the
--     scheduled sweep stays harmless.
--   * a BEFORE DELETE trigger rejects deleting a team organization by any
--     path. A personal organization still goes with its user, as upstream.
--
-- Re-runnable: create or replace, drop-before-create trigger.

create or replace function public.soft_delete_organization(p_org_id uuid,p_actor_id uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Organization deletion is not available'
    using errcode = '0A000';
end;
$$;

create or replace function public.purge_expired_organizations(p_limit integer default 10)
returns integer language plpgsql set search_path = public, pg_temp as $$
begin
  return 0;
end;
$$;

create or replace function public.organizations_no_team_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.kind = 'team' then
    raise exception 'Organization deletion is not available'
      using errcode = '0A000';
  end if;
  return old;
end;
$$;

revoke all on function public.organizations_no_team_delete() from public, anon, authenticated;

drop trigger if exists organizations_no_team_delete on public.organizations;
create trigger organizations_no_team_delete
  before delete on public.organizations
  for each row execute function public.organizations_no_team_delete();

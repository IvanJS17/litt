-- Migration date: 2026-10-24
--
-- LiTT account erasure (owner decision 2026-10-24; TD-008 partial).
--
-- Deleting an account erases what the person kept outside the firm's matters
-- and the Auth user itself. The firm's matter content stays with the firm,
-- detached from its author by the existing ON DELETE SET NULL keys. Audit and
-- AI evidence are insert-only and are never rewritten:
--
--   * audit_events.user_id and the AI evidence author/actor columns stop
--     being foreign keys to auth.users. As with audit_events.org_id, the id
--     is a historical reference: the row keeps naming the account that acted
--     after that account is gone, and the visible name comes from a join with
--     user_profiles, which disappears with the account ("Deleted user").
--     Before this, ON DELETE SET NULL tried to UPDATE insert-only audit rows
--     and ON DELETE RESTRICT refused, so no account with history could go.
--   * New audit rows no longer store the actor's address: identity is the
--     user id, and the address is read from the live profile. Rows written
--     before this keep theirs (insert-only); they hold synthetic data only,
--     since no real data enters before Gate E.
--   * The organization audit's sort by person reads the live profile address.
--   * account_deletion_receipts records each erasure for the person who
--     requested it: what was deleted, what was kept and why, and the date the
--     last backup copy disappears (backups keep 30 daily snapshots). The
--     person reads it with a bearer token stored here only as its SHA-256;
--     the row names no address.
--   * request_account_deletion takes that token hash instead of the address,
--     queues a job whose payload names only the user id, and audits the
--     request; complete_account_deletion closes the receipt and audits the
--     erasure, once.
--
-- Safe to re-run: drop if exists, create if not exists, create or replace,
-- drop-before-create triggers, revoke before grant.

alter table public.audit_events drop constraint if exists audit_events_user_id_fkey;
alter table public.ai_executions drop constraint if exists ai_executions_author_user_id_fkey;
alter table public.ai_reviews drop constraint if exists ai_reviews_execution_author_user_id_fkey;
alter table public.ai_reviews drop constraint if exists ai_reviews_reviewer_user_id_fkey;
alter table public.ai_review_decisions drop constraint if exists ai_review_decisions_actor_user_id_fkey;
alter table public.ai_review_drive_publications
  drop constraint if exists ai_review_drive_publications_actor_user_id_fkey;
alter table public.ai_redline_bundles drop constraint if exists ai_redline_bundles_reviewer_user_id_fkey;

create or replace function public.audit_events_without_actor_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_email := null;
  return new;
end;
$$;
revoke all on function public.audit_events_without_actor_email() from public, anon, authenticated;

drop trigger if exists audit_events_without_actor_email on public.audit_events;
create trigger audit_events_without_actor_email before insert on public.audit_events
  for each row execute function public.audit_events_without_actor_email();

create or replace function public.audit_actor_email(p_user_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select email from public.user_profiles where user_id = p_user_id;
$$;
revoke all on function public.audit_actor_email(uuid) from public, anon, authenticated;
grant execute on function public.audit_actor_email(uuid) to service_role;

create table if not exists public.account_deletion_receipts (
  -- Not foreign keys: the user is deleted and finished jobs are swept, and
  -- the receipt must outlive both.
  user_id uuid primary key,
  job_id uuid not null,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  backups_expire_on date,
  receipt jsonb,
  constraint account_deletion_receipts_completion check (
    (status = 'pending' and completed_at is null and backups_expire_on is null and receipt is null)
    or (status = 'completed' and completed_at is not null and backups_expire_on is not null
        and jsonb_typeof(receipt) = 'object')
  )
);
alter table public.account_deletion_receipts enable row level security;
revoke all on public.account_deletion_receipts from public, anon, authenticated;
grant select, insert, update on public.account_deletion_receipts to service_role;

drop function if exists public.request_account_deletion(uuid, text);
create function public.request_account_deletion(p_user_id uuid, p_token_sha256 text)
returns uuid language plpgsql set search_path = public as $$
declare job_id uuid; first_request boolean;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A receipt token hash is required' using errcode = '22023';
  end if;
  perform 1 from public.user_profiles where user_id = p_user_id for update;
  -- Removes every team membership (refusing a last owner with 23514) and so
  -- advances each organization's authorization epoch.
  perform public.prepare_account_org_departures(p_user_id);
  insert into public.db_jobs(kind, payload, dedupe_key, max_attempts)
    values ('account.delete', jsonb_build_object('userId', p_user_id), 'account.delete:' || p_user_id, 20)
    on conflict (dedupe_key) where dedupe_key is not null and status in ('pending', 'running')
      do update set dedupe_key = excluded.dedupe_key
    returning id into job_id;
  insert into public.account_deletion_receipts(user_id, job_id, token_sha256)
    values (p_user_id, job_id, p_token_sha256)
    on conflict (user_id) do update set job_id = excluded.job_id, token_sha256 = excluded.token_sha256
    returning (xmax = 0) into first_request;
  update public.user_profiles
    set account_deletion_requested_at = coalesce(account_deletion_requested_at, now())
    where user_id = p_user_id;
  if first_request then
    insert into public.audit_events(user_id, action, surface, detail)
      values (p_user_id, 'account.deletion.requested', 'account', jsonb_build_object('job_id', job_id));
  end if;
  return job_id;
end;
$$;
revoke all on function public.request_account_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid, text) to service_role;

create or replace function public.complete_account_deletion(p_user_id uuid, p_receipt jsonb)
returns void language plpgsql set search_path = public as $$
declare expires date;
begin
  if jsonb_typeof(p_receipt) is distinct from 'object' then
    raise exception 'A receipt object is required' using errcode = '22023';
  end if;
  -- The newest backup that can still hold the account is the one taken on
  -- the day erasure finished; 30 daily snapshots later it is pruned.
  expires := (now() at time zone 'utc')::date + 30;
  update public.account_deletion_receipts
    set status = 'completed', completed_at = now(), backups_expire_on = expires, receipt = p_receipt
    where user_id = p_user_id and status = 'pending';
  if found then
    insert into public.audit_events(user_id, action, surface, detail)
      values (p_user_id, 'account.deleted', 'account', jsonb_build_object('backups_expire_on', expires));
  end if;
end;
$$;
revoke all on function public.complete_account_deletion(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_account_deletion(uuid, jsonb) to service_role;

create or replace function public.organization_audit_events_page(
  p_org_id uuid, p_actor_id uuid, p_actor_email text,
  p_filter jsonb default '{}'::jsonb,
  p_sort_by text default 'created_at', p_sort_direction text default 'desc',
  p_offset integer default 0, p_limit integer default 50
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare candidates text; filtered text; result jsonb; ordering text;
begin
  if not exists(select 1 from public.active_org_members m
    where m.org_id=p_org_id and m.user_id=p_actor_id and m.role in ('owner','admin')) then
    return jsonb_build_object('events','[]'::jsonb,'total',0);
  end if;
  if p_sort_by is null or p_sort_by not in ('created_at','user_email','title','model')
    or p_sort_direction is null or p_sort_direction not in ('asc','desc') then
    raise exception 'Invalid audit sort' using errcode='22023';
  end if;
  p_limit:=greatest(1,least(coalesce(p_limit,50),2000));
  p_offset:=greatest(0,least(coalesce(p_offset,0),200000000));
  -- New audit rows carry no address; sorting by person uses the live
  -- profile, so a deleted account's events sort last.
  ordering:=case when p_sort_by='user_email'
    then format('public.audit_actor_email(user_id) %s nulls last, id asc',p_sort_direction)
    else format('%I %s nulls last, id asc',p_sort_by,p_sort_direction) end;
  -- Only allowlisted sort identifiers are interpolated. All filter values
  -- remain bound parameters, including arrays, search patterns and dates.
  candidates:=$query$
    select a.* from public.audit_events a where a.org_id=$1
      and ($4->>'username_pattern' is null or a.user_email ilike $4->>'username_pattern'
        or exists(select 1 from public.user_profiles profile where profile.user_id=a.user_id
          and (profile.display_name ilike $4->>'username_pattern' or profile.email ilike $4->>'username_pattern')))
      and ($4->>'action' is null or a.action=$4->>'action')
      and ($4->>'status' is null or a.status=$4->>'status')
      and ($4->>'surface' is null or a.surface=$4->>'surface')
      and ($4->>'actor_user_id' is null or a.user_id=($4->>'actor_user_id')::uuid)
      and ($4->>'from' is null or a.created_at>=($4->>'from')::timestamptz)
      and ($4->>'to' is null or a.created_at<=($4->>'to')::timestamptz)
      and (not ($4 ? 'event_ids') or a.id=any(array(select jsonb_array_elements_text($4->'event_ids')::uuid)))
      and (not ($4 ? 'user_ids') or a.user_id=any(array(select jsonb_array_elements_text($4->'user_ids')::uuid)))
  $query$;
  if p_filter->>'title_pattern' is not null or p_sort_by='title' then
    -- These operations depend on visible titles, so they necessarily inspect
    -- the metadata-filtered candidates. Materialize once for both count/page.
    filtered:=format($query$
      with candidates as (%s), visible as materialized (
        select * from public.organization_audit_events($1,$2,$3,array(select id from candidates))
      ), filtered as not materialized (
        select * from visible where $4->>'title_pattern' is null or title ilike $4->>'title_pattern'
      ), page as (select * from filtered order by %s limit $5 offset $6)
      select jsonb_build_object(
        'events',coalesce((select jsonb_agg(to_jsonb(page) order by %s) from page),'[]'::jsonb),
        'total',(select count(*) from filtered))
    $query$,candidates,ordering,ordering);
  else
    -- NOT MATERIALIZED permits the count and page to use separate index scans.
    -- The expensive resource joins/permission checks see only this page's IDs.
    filtered:=format($query$
      with candidates as not materialized (%s),
      page as materialized (select id from candidates order by %s limit $5 offset $6),
      visible as (
        select * from public.organization_audit_events($1,$2,$3,array(select id from page))
      )
      select jsonb_build_object(
        'events',coalesce((select jsonb_agg(to_jsonb(visible) order by %s) from visible),'[]'::jsonb),
        'total',(select count(*) from candidates))
    $query$,candidates,ordering,ordering);
  end if;
  execute filtered into result using p_org_id,p_actor_id,p_actor_email,coalesce(p_filter,'{}'::jsonb),p_limit,p_offset;
  return result;
end;
$$;
revoke all on function public.organization_audit_events_page(uuid,uuid,text,jsonb,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.organization_audit_events_page(uuid,uuid,text,jsonb,text,text,integer,integer) to service_role;

-- A private-content permission change names the admin by id only; the
-- address is no longer copied into the insert-only audit title. Earlier rows
-- are left as written.
create or replace function public.set_org_private_content_permission(p_org_id uuid,p_actor_id uuid,p_target_id uuid,p_enabled boolean)
returns void language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from public.organizations where id=p_org_id and kind='team' and deleted_at is null for update;
  if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
  perform 1 from public.org_members where org_id=p_org_id and user_id=p_actor_id and role='owner' for update;
  if not found then raise exception 'Owner required' using errcode='42501'; end if;
  perform 1 from public.org_members where org_id=p_org_id and user_id=p_target_id and role='admin' for update;
  if not found then raise exception 'Choose an organization admin' using errcode='23514'; end if;
  if p_enabled is null then raise exception 'Choose a permission' using errcode='23514'; end if;
  update public.org_members set can_access_private_content=p_enabled,updated_at=now()
    where org_id=p_org_id and user_id=p_target_id;
  -- The admin is named by id only. The audit read resolves the live profile,
  -- so an erased account leaves no address in this insert-only row.
  insert into public.audit_events(org_id,user_id,action,surface,detail)
    values(p_org_id,p_actor_id,'org.private_content.permission_changed','organization',
      jsonb_build_object('target_user_id',p_target_id,'enabled',p_enabled));
end;
$$;

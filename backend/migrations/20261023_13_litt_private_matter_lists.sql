-- Migration date: 2026-10-23
--
-- Private matters across lists, ownerless takeover and member departure
-- (LiTT sync 2026-10-23, S2; condition C2 of docs/UPSTREAM_SYNC_PLAN.md §3).
--
-- 1. private_matter_denied_project_ids(user, projects) answers, for many
--    projects at once, exactly what project_private_matter_denied
--    (20261023_10) answers for one: the backend's list filters ask it
--    instead of re-deriving the rule.
-- 2. project_is_ownerless is false for a matter's project, so upstream's
--    "ownerless" takeover never gives an organization owner a private matter
--    (or a stronger role inside one) because its creator left.
-- 3. org_members_departure_items leaves a matter's project out of a departing
--    member's items: it is not archived away from the matter team and not
--    handed to a successor chosen by an organization owner.
--
-- Re-runnable: create or replace.

create or replace function public.private_matter_denied_project_ids(
  p_user_id text,
  p_project_ids uuid[]
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct project_id
  from unnest(coalesce(p_project_ids, '{}'::uuid[])) as ids(project_id)
  where public.project_private_matter_denied(project_id, p_user_id);
$$;

revoke all on function public.private_matter_denied_project_ids(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.private_matter_denied_project_ids(text, uuid[])
  to service_role;

create or replace function public.project_is_ownerless(
  p_project_id uuid,
  p_project_user_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_org_id is not null
    -- LiTT C2: a matter's project belongs to the matter team, never to the
    -- organization's owners, whoever created it.
    and not exists(select 1 from public.matters mt where mt.project_id=p_project_id)
    and not exists(select 1 from public.projects where id=p_project_id and archived_at is not null)
    and not exists (
      select 1 from public.org_members creator
      where creator.org_id = p_org_id and creator.user_id = p_project_user_id
    )
    and not exists (
      select 1 from public.project_org_access_overrides o
      where o.project_id = p_project_id and o.role = 'owner'
    );
$$;

create or replace function public.org_members_departure_items(p_org_id uuid,p_user_ids uuid[])
returns table(kind text,item_id uuid,title text,disposition text)
language sql stable set search_path = public as $$
  with roots as (
select 'project'::text kind,item.id item_id,
    case when item.visibility='organization' then item.name else null::text end title,
    case when (item.visibility='organization' or exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.projects item where item.org_id=p_org_id and item.archived_at is null
    -- LiTT C2: a matter's project stays with the matter team when a member
    -- leaves; it is neither archived nor handed to a successor.
    and not exists (select 1 from public.matters mt where mt.project_id=item.id)
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'workflow'::text kind,item.id item_id,
    case when item.visibility='organization' then item.title else null::text end title,
    case when (item.visibility='organization' or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.workflows item where item.org_id=p_org_id and item.archived_at is null

    and (item.user_id=any(p_user_ids) or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'chat'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.chats item where item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'tabular_review'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.tabular_reviews item where item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
  ), documents as (
    select 'document'::text kind,d.id item_id,null::text title,
      case when exists (
        select 1 from public.chats c
        where c.org_id=p_org_id and c.archived_at is null
          and not exists(select 1 from public.projects p where p.id=c.project_id and p.archived_at is not null)
          and exists (select 1 from public.org_item_document_ids('chat',c.id) ref where ref.document_id=d.id)
          and not exists (select 1 from roots r where r.kind='chat' and r.item_id=c.id and r.disposition='archive')
          and (c.project_id is null or not exists (select 1 from roots r where r.kind='project' and r.item_id=c.project_id and r.disposition='archive'))
      ) or exists (
        select 1 from public.tabular_reviews tr
        where tr.org_id=p_org_id and tr.archived_at is null
          and not exists(select 1 from public.projects p where p.id=tr.project_id and p.archived_at is not null)
          and exists (select 1 from public.org_item_document_ids('tabular_review',tr.id) ref where ref.document_id=d.id)
          and not exists (select 1 from roots r where r.kind='tabular_review' and r.item_id=tr.id and r.disposition='archive')
          and (tr.project_id is null or not exists (select 1 from roots r where r.kind='project' and r.item_id=tr.project_id and r.disposition='archive'))
      ) then 'transfer' else 'archive' end disposition
    from public.documents d where d.org_id=p_org_id and d.user_id=any(p_user_ids)
      and d.project_id is null and d.workflow_id is null and d.archived_at is null
  ) select * from roots union all select * from documents;
$$;

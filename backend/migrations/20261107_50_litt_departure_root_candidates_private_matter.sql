-- Migration date: 2026-11-07
--
-- LiTT adaptation of upstream 20261101_18_departure_root_candidates (M-S5)
-- (upstream cycle 5 of 10, pin d0a7ca75). Upstream finds a departure's
-- possible roots by departing user first (creator index, owner overrides and
-- owner grants) instead of testing every item in the organization. Its text
-- copies the departure roots without LiTT's private-matter rule, which
-- 20261101_51_litt_departure_private_matter had restored over upstream's
-- earlier rewrites:
--
--   * C2 point 3 (20261023_13): a project bound to a matter is never a
--     departing member's item. It is not archived away from the matter team
--     and not handed to a successor chosen by an organization owner.
--
-- Upstream's 20261101_18 sorts before 20261101_51, so a database that already
-- ran 20261101_51 would run 20261101_18 afterwards and lose the guard. This
-- migration sorts after both and re-creates the function from upstream's
-- 20261101_18 text with the guard; the rest is upstream's text.
-- backend/src/__tests__/sql/performance.litt-private-matters.sql and
-- performance.references.sql prove the guard: a departing creator's matter
-- project is not listed. Control 4 in
-- performance.litt-private-matters-controls.sql proves upstream's text alone
-- would list it.
--
-- Safe to re-run: create or replace, same signature.

create or replace function public.org_members_departure_items(p_org_id uuid,p_user_ids uuid[])
returns table(kind text,item_id uuid,title text,disposition text)
language sql stable set search_path = public as $$
  with roots as (
select 'project'::text kind,item.id item_id,
    case when item.visibility='organization' then item.name else null::text end title,
    case when (item.visibility='organization' or exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.projects item where item.id in (
      -- Only items a departing member created or co-owns can be roots; the
      -- conditions below are evaluated for those, not every org project.
      -- Per departing member, a lookup by creator (user_id index); the
      -- organization is checked on the few rows found, never scanned.
      select p.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.projects own where own.user_id=leaver.id offset 0) p
        where p.org_id=p_org_id
      union select g.project_id from unnest(p_user_ids) leaver(id) join public.project_org_access_overrides g on g.user_id=leaver.id
        join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id
        where g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null
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
  from public.workflows item where item.id in (
      select w.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.workflows own where own.user_id=leaver.id offset 0) w
        where w.org_id=p_org_id
      union select g.workflow_id from unnest(p_user_ids) leaver(id) join public.workflow_org_access_overrides g on g.user_id=leaver.id
        join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id
        where g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null

    and (item.user_id=any(p_user_ids) or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'chat'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.chats item where item.id in (
      select c.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.chats own where own.user_id=leaver.id offset 0) c
        where c.org_id=p_org_id
      union select g.chat_id from unnest(p_user_ids) leaver(id) join public.user_profiles profile on profile.user_id=leaver.id
        join public.chat_access_grants g on g.email=lower(profile.email)
        join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id
        where profile.email is not null and btrim(profile.email)<>'' and g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'tabular_review'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.tabular_reviews item where item.id in (
      select r.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.tabular_reviews own where own.user_id=leaver.id offset 0) r
        where r.org_id=p_org_id
      union select g.tabular_review_id from unnest(p_user_ids) leaver(id) join public.user_profiles profile on profile.user_id=leaver.id
        join public.tabular_review_access_grants g on g.email=lower(profile.email)
        join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id
        where profile.email is not null and btrim(profile.email)<>'' and g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
  ), retained_documents as materialized (
    -- Start from the departing members' standalone documents (few) and look
    -- up who references each one, instead of expanding every chat message
    -- and review row in the organization. A reference counts when its chat
    -- or review is retained: live in this org, its project not archived, and
    -- neither it nor its project archived by this departure.
    select distinct d.id document_id
    from public.documents d
    cross join lateral public.document_referencing_items(d.id) ref
    left join public.chats c on ref.kind='chat' and c.id=ref.item_id
    left join public.tabular_reviews tr on ref.kind='tabular_review' and tr.id=ref.item_id
    where d.org_id=p_org_id and d.user_id=any(p_user_ids)
      and d.project_id is null and d.workflow_id is null and d.archived_at is null
      and case ref.kind when 'chat' then c.org_id=p_org_id and c.archived_at is null
        else tr.org_id=p_org_id and tr.archived_at is null end
      and not exists(select 1 from public.projects p where p.id=ref.project_id and p.archived_at is not null)
      and not exists(select 1 from roots r where r.kind=ref.kind and r.item_id=ref.item_id and r.disposition='archive')
      and (ref.project_id is null or not exists(select 1 from roots r where r.kind='project' and r.item_id=ref.project_id and r.disposition='archive'))
  ), documents as (
    select 'document'::text kind,d.id item_id,null::text title,
      case when d.id in (select document_id from retained_documents) then 'transfer' else 'archive' end disposition
    from public.documents d where d.org_id=p_org_id and d.user_id=any(p_user_ids)
      and d.project_id is null and d.workflow_id is null and d.archived_at is null
  ) select * from roots union all select * from documents;
$$;
revoke all on function public.org_members_departure_items(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.org_members_departure_items(uuid,uuid[]) to service_role;

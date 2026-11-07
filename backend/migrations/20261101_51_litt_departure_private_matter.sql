-- Migration date: 2026-11-07
--
-- LiTT adaptation of upstream 20261101_06_departure_email_index_joins (S11)
-- and 20261101_08_departure_reverse_references (S4b) (upstream cycle 4 of 10,
-- pin 31539729). Upstream rewrites org_members_departure_items twice: grant
-- e-mail joins that can use the partial e-mail index, and departing
-- documents classified by reverse reference lookups. Both texts copy the
-- departure roots without LiTT's private-matter rule, which
-- 20261030_51_litt_departure_private_matter had restored:
--
--   * C2 point 3 (20261023_13): a project bound to a matter is never a
--     departing member's item. It is not archived away from the matter team
--     and not handed to a successor chosen by an organization owner.
--
-- This migration re-creates the function from upstream's final (20261101_08)
-- text with that guard; the rest is upstream's text. It runs after
-- 20261101_08 in filename order on fresh and existing databases alike.
-- backend/src/__tests__/sql/performance.references.sql proves the guard: a
-- departing creator's matter project is not listed.
--
-- Safe to re-run: create or replace, same signature.

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
    case when (exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.chats item where item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'tabular_review'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.tabular_reviews item where item.org_id=p_org_id and item.archived_at is null
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

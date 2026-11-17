-- Migration date: 2026-11-16
--
-- Firm-wide COUNTS of the requests of the firm's retainer matters, for the
-- firm's owners and admins (docs/matter-requests.md, "Firm counts").
--
-- An owner or admin who is not on a private matter's team cannot open it, so
-- they cannot read its requests. They get numbers only: this function returns
-- counts, a day count and an opaque ordinal per matter, and never a title, a
-- matter name, a person or any other text of a request. The ordinal ("Iguala
-- 3") is the matter's position among the firm's retainer matters by creation
-- date; it is not the matter's name, because a private matter's name is not
-- visible to people outside its team.
--
-- Migration number: 50 on purpose (another branch may add 40 the same day).
--
-- The caller is checked here as well as in the service: the function raises
-- insufficient_privilege unless p_user_id is an owner or admin of the team
-- organization. It is `security definer` with a pinned search_path and may be
-- executed by service_role only.
--
-- Period: p_start..p_end, both inclusive dates. The cohort of every breakdown
-- is the requests RECEIVED in the period, in their state today. The totals
-- add the requests closed in the period (whenever received), the requests
-- still open at the end of the period, and the median calendar days from
-- received_on to closed_on of the requests closed in the period (days, never
-- hours). Cancelled requests are counted apart and never enter the median.
--
-- Re-runnable: create or replace function, grants repeated.

create or replace function public.matter_request_counts(
  p_org_id uuid,
  p_user_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.org_members om
    join public.organizations o on o.id = om.org_id
    where om.org_id = p_org_id
      and om.user_id = p_user_id
      and om.role in ('owner', 'admin')
      and o.kind = 'team'
  ) then
    raise exception 'only an owner or admin of the firm reads its request counts'
      using errcode = '42501';
  end if;

  return (
    with ms as (
      select m.id, (row_number() over (order by m.created_at, m.id))::int as ordinal
      from public.matters m
      join public.workspaces w on w.id = m.workspace_id
      where w.organization_id = p_org_id
        and m.is_retainer
        and m.visibility = 'private'
    ),
    rq as (
      select r.id, r.matter_id, r.type_id, r.complexity, r.status,
             r.assignee_level, r.received_on, r.closed_on, ms.ordinal
      from public.matter_requests r
      join ms on ms.id = r.matter_id
    ),
    cohort as (
      select * from rq where received_on between p_start and p_end
    ),
    rounds as (
      select c.id as request_id, count(distinct rr.round_number)::int as n
      from cohort c
      join public.matter_request_rounds rr on rr.request_id = c.id
      group by c.id
    ),
    closed_in as (
      select * from rq
      where status = 'closed' and closed_on between p_start and p_end
    ),
    medians as (
      select matter_id,
             round((percentile_cont(0.5) within group (order by closed_on - received_on))::numeric, 1) as days
      from closed_in
      group by matter_id
    ),
    totals as (
      select
        (select count(*) from cohort)::int as received,
        (select count(*) from cohort where status not in ('closed', 'cancelled'))::int as open,
        (select count(*) from cohort where status = 'closed')::int as closed,
        (select count(*) from cohort where status = 'cancelled')::int as cancelled,
        (select count(*) from rq
          where received_on <= p_end and (closed_on is null or closed_on > p_end))::int as open_at_end,
        (select count(*) from closed_in)::int as closed_in_period,
        (select count(*) from rq
          where status = 'cancelled' and closed_on between p_start and p_end)::int as cancelled_in_period,
        coalesce((select sum(n) from rounds), 0)::int as rounds,
        (select round((percentile_cont(0.5) within group (order by closed_on - received_on))::numeric, 1)
           from closed_in) as median_days
    )
    select jsonb_build_object(
      'period_start', p_start,
      'period_end', p_end,
      'totals', (select to_jsonb(totals) from totals),
      'by_matter', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ordinal', ms.ordinal,
          'total', coalesce(s.total, 0),
          'open', coalesce(s.open, 0),
          'closed', coalesce(s.closed, 0),
          'cancelled', coalesce(s.cancelled, 0),
          'rounds', coalesce(s.rounds, 0),
          'median_days', md.days
        ) order by ms.ordinal)
        from ms
        left join (
          select c.matter_id,
                 count(*)::int as total,
                 (count(*) filter (where c.status not in ('closed', 'cancelled')))::int as open,
                 (count(*) filter (where c.status = 'closed'))::int as closed,
                 (count(*) filter (where c.status = 'cancelled'))::int as cancelled,
                 coalesce(sum(r.n), 0)::int as rounds
          from cohort c
          left join rounds r on r.request_id = c.id
          group by c.matter_id
        ) s on s.matter_id = ms.id
        left join medians md on md.matter_id = ms.id
      ), '[]'::jsonb),
      'by_type', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type_id', t.id,
          'seed_key', t.seed_key,
          'name', t.name,
          'archived', t.archived_at is not null,
          'total', s.total,
          'open', s.open,
          'closed', s.closed,
          'cancelled', s.cancelled
        ) order by t.sort_order, t.created_at, t.id)
        from public.matter_request_types t
        cross join lateral (
          select count(c.id)::int as total,
                 (count(c.id) filter (where c.status not in ('closed', 'cancelled')))::int as open,
                 (count(c.id) filter (where c.status = 'closed'))::int as closed,
                 (count(c.id) filter (where c.status = 'cancelled'))::int as cancelled
          from cohort c where c.type_id = t.id
        ) s
        where t.organization_id = p_org_id
          and (t.archived_at is null or s.total > 0)
      ), '[]'::jsonb),
      'by_complexity', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', k.key,
          'total', s.total, 'open', s.open, 'closed', s.closed, 'cancelled', s.cancelled
        ) order by k.ord)
        from unnest(array['routine', 'standard', 'complex']) with ordinality as k(key, ord)
        cross join lateral (
          select count(c.id)::int as total,
                 (count(c.id) filter (where c.status not in ('closed', 'cancelled')))::int as open,
                 (count(c.id) filter (where c.status = 'closed'))::int as closed,
                 (count(c.id) filter (where c.status = 'cancelled'))::int as cancelled
          from cohort c where c.complexity = k.key
        ) s
      ), '[]'::jsonb),
      'by_level', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', k.key,
          'total', s.total, 'open', s.open, 'closed', s.closed, 'cancelled', s.cancelled
        ) order by k.ord)
        from unnest(array['apprentice', 'junior', 'senior', 'partner', 'unassigned']) with ordinality as k(key, ord)
        cross join lateral (
          select count(c.id)::int as total,
                 (count(c.id) filter (where c.status not in ('closed', 'cancelled')))::int as open,
                 (count(c.id) filter (where c.status = 'closed'))::int as closed,
                 (count(c.id) filter (where c.status = 'cancelled'))::int as cancelled
          from cohort c where coalesce(c.assignee_level, 'unassigned') = k.key
        ) s
      ), '[]'::jsonb),
      'by_status', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', k.key,
          'total', (select count(*) from cohort c where c.status = k.key)::int
        ) order by k.ord)
        from unnest(array['received', 'in_review', 'with_client', 'with_counterparty', 'closed', 'cancelled'])
          with ordinality as k(key, ord)
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.matter_request_counts(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.matter_request_counts(uuid, uuid, date, date)
  to service_role;

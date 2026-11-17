-- Migration date: 2026-11-17
--
-- Radar obligation items: the order of actions is per DATE of the item.
--
-- An item key (`<rule>@<version>:<anchor>`) can show a different computed date
-- when the same fact is anchored in another mode (direct vs first cycle). The
-- read model (radar.shared.ts stateOf) only counts the events of the item's
-- CURRENT date, so the item reads "open" again; the guard looked at the last
-- event of the key whatever its date and refused a second `ack` ("a ack action
-- does not follow ack"). The guard now looks at the last event of the same key
-- AND the same date, which is what the read model does. Nothing else changes:
-- insert-only, one way (nothing, ack, then dismiss or done), matter row locked.
create or replace function public.matter_obligation_item_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'matter_obligation_item_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  perform 1 from public.matters where id = new.matter_id for update;
  select e.action into latest
    from public.matter_obligation_item_events e
    where e.matter_id = new.matter_id
      and e.item_key = new.item_key
      and e.due_on is not distinct from new.due_on
    order by e.created_at desc, e.id desc
    limit 1;
  if not (
    (new.action = 'ack' and latest is null)
    or (new.action in ('dismiss', 'done') and (latest is null or latest = 'ack'))
  ) then
    raise exception 'a % action does not follow %', new.action, coalesce(latest, 'nothing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.matter_obligation_item_events_guard() from public, anon, authenticated;

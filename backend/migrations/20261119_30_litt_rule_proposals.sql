-- Migration date: 2026-11-19
--
-- AI proposals of NEW obligation rules from an uploaded law text
-- (docs/obligation-rules.md, "Rule proposals"; flow (a), S8b). Extends the
-- tables of 20261119_20_litt_rule_suggestions.sql.
--
-- A proposal is an UNVERIFIED DRAFT: it never carries a date or an operation,
-- it cannot be turned on (it is not a catalog rule: the catalog is code and
-- changes with a reviewed pull request) and it is not read by any calculation.
-- It lives in a FIRM project (a project that is not a matter), never in a
-- client or retainer matter.
--
--   obligation_rule_suggestions: `flow` gains 'new_rule_draft'. A draft has no
--   matter and no catalog rule; it carries a closed `draft` object (law,
--   article, obligation, anchor_name and plazo_propuesto: free-text draft term
--   that no calculation reads) plus the provider and model that wrote it. The
--   shape per flow is a table constraint.
--
--   obligation_rule_suggestion_events: gains 'sent_to_legal' and
--   'implemented' (the latter with the catalog code the proposal became, set
--   by a person once a pull request added it to the catalog). The order for a
--   draft is enforced here: nothing, then sent_to_legal or discarded;
--   sent_to_legal, then implemented or discarded; discarded and implemented are
--   final. 'implemented' needs an actor (a person) and a catalog code.
--
-- Whether the quote is in the text, whether a date was written in the term and
-- whether the catalog code exists in the deployed catalog are the backend's
-- checks. Drafts are read through the backend only (project access is checked
-- there): the browser policies still cover matter suggestions only.
--
-- Re-runnable: columns and indexes use if not exists, constraints, triggers
-- and policies are dropped before they are created, functions use create or
-- replace.

alter table public.obligation_rule_suggestions drop constraint if exists obligation_rule_suggestions_flow_check;
alter table public.obligation_rule_suggestions
  add constraint obligation_rule_suggestions_flow_check check (flow in ('catalog_match', 'new_rule_draft'));

alter table public.obligation_rule_suggestions alter column matter_id drop not null;
alter table public.obligation_rule_suggestions alter column rule_code drop not null;
alter table public.obligation_rule_suggestions alter column rule_version drop not null;
alter table public.obligation_rule_suggestions alter column ai_reason drop not null;
alter table public.obligation_rule_suggestions add column if not exists draft jsonb;
alter table public.obligation_rule_suggestions add column if not exists ai_provider text;
alter table public.obligation_rule_suggestions add column if not exists ai_model text;

alter table public.obligation_rule_suggestions drop constraint if exists obligation_rule_suggestions_flow_shape;
alter table public.obligation_rule_suggestions
  add constraint obligation_rule_suggestions_flow_shape check (
    (flow = 'catalog_match'
      and matter_id is not null and rule_code is not null and rule_version is not null
      and ai_reason is not null and draft is null and ai_provider is null and ai_model is null)
    or
    (flow = 'new_rule_draft'
      and matter_id is null and rule_code is null and rule_version is null
      and ai_reason is null and draft is not null
      and ai_provider is not null and char_length(ai_provider) between 1 and 80
      and ai_model is not null and char_length(ai_model) between 1 and 200)
  );

-- The closed draft: these keys and no others. No date and no operation exist.
alter table public.obligation_rule_suggestions drop constraint if exists obligation_rule_suggestions_draft_shape;
alter table public.obligation_rule_suggestions
  add constraint obligation_rule_suggestions_draft_shape check (
    draft is null or (
      jsonb_typeof(draft) = 'object'
      and draft ?& array['law', 'article', 'obligation', 'anchor_name']
      and (draft - array['law', 'article', 'obligation', 'anchor_name', 'plazo_propuesto']) = '{}'::jsonb
      and jsonb_typeof(draft -> 'law') = 'string' and char_length(draft ->> 'law') between 1 and 200
      and jsonb_typeof(draft -> 'article') = 'string' and char_length(draft ->> 'article') between 1 and 100
      and jsonb_typeof(draft -> 'obligation') = 'string' and char_length(draft ->> 'obligation') between 1 and 300
      and jsonb_typeof(draft -> 'anchor_name') = 'string' and char_length(draft ->> 'anchor_name') between 1 and 120
      and coalesce(jsonb_typeof(draft -> 'plazo_propuesto'), 'null') in ('null', 'string')
      and coalesce(char_length(draft ->> 'plazo_propuesto'), 1) between 1 and 80
    )
  );

-- The same passage of the same text is one draft (also when two runs race).
create unique index if not exists obligation_rule_suggestions_draft_once_idx
  on public.obligation_rule_suggestions (version_id, text_sha256, start_char, end_char)
  where flow = 'new_rule_draft';
create index if not exists obligation_rule_suggestions_project_drafts_idx
  on public.obligation_rule_suggestions (project_id, created_at desc, id)
  where flow = 'new_rule_draft';

-- A suggestion is written once. A catalog match goes into a private retainer
-- matter (a public matter fails closed); a draft goes into a project of the
-- organization that is bound to NO matter.
create or replace function public.obligation_rule_suggestions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'obligation_rule_suggestions is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  if new.flow = 'catalog_match' then
    if not exists (
      select 1 from public.matters m
      where m.id = new.matter_id and m.is_retainer and m.visibility = 'private'
    ) then
      raise exception 'rule suggestions belong to a private retainer matter' using errcode = '23514';
    end if;
  else
    if not exists (
      select 1 from public.projects p
      where p.id = new.project_id and p.org_id is not null and p.org_id = new.org_id
    ) or exists (
      select 1 from public.matters m where m.project_id = new.project_id
    ) then
      raise exception 'rule proposals belong to a firm project that is not a matter' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.obligation_rule_suggestions_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_suggestions_guard_trigger on public.obligation_rule_suggestions;
create trigger obligation_rule_suggestions_guard_trigger
  before insert or update or delete on public.obligation_rule_suggestions
  for each row execute function public.obligation_rule_suggestions_guard();

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
alter table public.obligation_rule_suggestion_events alter column matter_id drop not null;
alter table public.obligation_rule_suggestion_events add column if not exists catalog_code text;

alter table public.obligation_rule_suggestion_events drop constraint if exists obligation_rule_suggestion_events_action_check;
alter table public.obligation_rule_suggestion_events
  add constraint obligation_rule_suggestion_events_action_check
  check (action in ('accepted', 'discarded', 'sent_to_legal', 'implemented'));

alter table public.obligation_rule_suggestion_events drop constraint if exists obligation_rule_suggestion_events_catalog_code_shape;
alter table public.obligation_rule_suggestion_events
  add constraint obligation_rule_suggestion_events_catalog_code_shape check (
    (action = 'implemented') = (catalog_code is not null)
    and (catalog_code is null or (catalog_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and char_length(catalog_code) <= 80))
  );

-- 'implemented' is a person's record: it needs an actor.
alter table public.obligation_rule_suggestion_events drop constraint if exists obligation_rule_suggestion_events_implemented_actor;
alter table public.obligation_rule_suggestion_events
  add constraint obligation_rule_suggestion_events_implemented_actor check (action <> 'implemented' or actor_user_id is not null);

-- A draft's events have no matter, so the composite key to the suggestion does
-- not apply to them (a null column is not checked): the suggestion itself is.
alter table public.obligation_rule_suggestion_events drop constraint if exists obligation_rule_suggestion_events_suggestion_id_fk;
alter table public.obligation_rule_suggestion_events
  add constraint obligation_rule_suggestion_events_suggestion_id_fk
  foreign key (suggestion_id) references public.obligation_rule_suggestions(id) on delete restrict;

-- Insert-only and one way. Catalog match: nothing, then accepted or discarded;
-- an accepted one may still be discarded. Draft: nothing, then sent_to_legal or
-- discarded; sent_to_legal, then implemented or discarded; discarded and
-- implemented end it. The suggestion row is locked while the event is checked
-- (security definer: the backend role may insert, not update), so two
-- decisions at once cannot both pass.
create or replace function public.obligation_rule_suggestion_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent record;
  latest text;
  allowed boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'obligation_rule_suggestion_events is insert-only; % is not allowed', tg_op
      using errcode = '55000';
  end if;
  select s.flow, s.matter_id into parent
    from public.obligation_rule_suggestions s where s.id = new.suggestion_id for update;
  if not found then
    -- No such suggestion: the foreign key says so.
    return new;
  end if;
  if new.matter_id is distinct from parent.matter_id then
    raise exception 'the event names another matter than its suggestion' using errcode = '23514';
  end if;
  select e.action into latest
    from public.obligation_rule_suggestion_events e
    where e.suggestion_id = new.suggestion_id
    order by e.created_at desc, e.id desc
    limit 1;
  if parent.flow = 'catalog_match' then
    allowed := (new.action = 'accepted' and latest is null)
      or (new.action = 'discarded' and (latest is null or latest = 'accepted'));
  else
    allowed := (new.action = 'sent_to_legal' and latest is null)
      or (new.action = 'discarded' and (latest is null or latest = 'sent_to_legal'))
      or (new.action = 'implemented' and latest is not null and latest = 'sent_to_legal');
  end if;
  if not coalesce(allowed, false) then
    raise exception 'a % event does not follow %', new.action, coalesce(latest, 'nothing')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.obligation_rule_suggestion_events_guard() from public, anon, authenticated;

drop trigger if exists obligation_rule_suggestion_events_guard_trigger on public.obligation_rule_suggestion_events;
create trigger obligation_rule_suggestion_events_guard_trigger
  before insert or update or delete on public.obligation_rule_suggestion_events
  for each row execute function public.obligation_rule_suggestion_events_guard();

-- ---------------------------------------------------------------------------
-- RLS: a browser user reads matter suggestions of matters they belong to; a
-- draft (no matter) is read through the backend, which checks the project.
-- ---------------------------------------------------------------------------
drop policy if exists obligation_rule_suggestions_select_member on public.obligation_rule_suggestions;
create policy obligation_rule_suggestions_select_member on public.obligation_rule_suggestions
  for select to authenticated using (matter_id is not null and public.matter_role(matter_id) is not null);

drop policy if exists obligation_rule_suggestion_events_select_member on public.obligation_rule_suggestion_events;
create policy obligation_rule_suggestion_events_select_member on public.obligation_rule_suggestion_events
  for select to authenticated using (matter_id is not null and public.matter_role(matter_id) is not null);

-- Migration date: 2026-10-23
--
-- Memory is opt-in in LiTT (LiTT sync 2026-10-23, S1). LiTT's ports of
-- upstream's scoped memory (20260910_06/07) are dropped as re-issues, but
-- they carried one LiTT decision upstream does not have: no memory is enabled
-- unless a person enables their own, or a project's creator enables the
-- project's. Upstream ships project memory and new accounts' memory enabled.
--
-- This keeps upstream's current function bodies and changes only the value a
-- memory file is created with:
--   * memory_files.enabled and user_profiles.project_memory_default default
--     to false;
--   * a new account, a newly seeded organization memory, a re-seeded memory
--     after wiping private memories, and a project memory first created by
--     the curator all start disabled.
-- Existing rows are not changed. Re-runnable: set default, create or replace.

alter table public.memory_files alter column enabled set default false;
alter table public.user_profiles alter column project_memory_default set default false;

create or replace function public.initialize_new_user_memory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.memory_files(scope, user_id, enabled)
  values ('user', new.id, false)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.ensure_user_memory_file(
  p_user_id uuid,
  p_org_id uuid
)
returns setof public.memory_files
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_org_id is not null and not exists (
    select 1 from public.active_org_members member
    where member.org_id = p_org_id and member.user_id = p_user_id
  ) then
    return;
  end if;
  if not exists (
    select 1 from public.memory_files file
    where file.scope = 'user'
      and file.user_id = p_user_id
      and file.org_id is not distinct from p_org_id
  ) then
    insert into public.memory_files(scope, user_id, org_id, enabled)
    values (
      'user',
      p_user_id,
      p_org_id,
      coalesce((
        select personal.enabled from public.memory_files personal
        where personal.scope = 'user'
          and personal.user_id = p_user_id
          and personal.org_id is null
      ), false)
    )
    on conflict do nothing;
  end if;
  return query
    select file.* from public.memory_files file
    where file.scope = 'user'
      and file.user_id = p_user_id
      and file.org_id is not distinct from p_org_id;
end;
$$;

create or replace function public.delete_user_private_memories(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
  deleted_projects integer := 0;
begin
  -- Lock the caller's own private projects rather than the whole table.
  -- FOR UPDATE on a project row blocks both a move into an organization (an
  -- UPDATE of that row) and a new access grant (the grant's foreign key takes
  -- KEY SHARE on the project, which FOR UPDATE excludes), so eligibility
  -- cannot change between this check and the wipe. A table-level SHARE lock
  -- did the same job by stalling every project write in the system for as
  -- long as this user's files took to wipe.
  perform project.id from public.projects project
  where project.user_id = p_user_id and project.org_id is null
  order by project.id
  for update;

  insert into public.memory_files(scope, user_id, enabled)
  values ('user', p_user_id, false)
  on conflict do nothing;

  for target in
    select eligible.id, eligible.scope
    from (
      -- Every memory that is this person's own: Personal, and the one
      -- they have in each organization they belong to.
      select file.id, file.scope
      from public.memory_files file
      where file.scope = 'user' and file.user_id = p_user_id
      union all
      select file.id, file.scope
      from public.memory_files file
      join public.projects project on project.id = file.project_id
      where file.scope = 'project'
        and project.user_id = p_user_id
        and project.org_id is null
        and not exists (
          select 1 from public.project_access_grants grant_row
          where grant_row.project_id = project.id
        )
    ) eligible
    order by eligible.id
  loop
    perform public.wipe_memory_file(target.id, null, p_user_id, 'wipe');
    if target.scope = 'project' then
      deleted_projects := deleted_projects + 1;
    end if;
  end loop;

  return deleted_projects;
end;
$$;

create or replace function public.schedule_memory_consolidation(
  p_surface text,
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_turn_id uuid,
  p_activity_id uuid,
  p_quiet_seconds integer
)
returns table(job_id uuid, generation bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state public.memory_consolidation_states%rowtype;
  activity public.memory_conversation_activity%rowtype;
  queued_state public.memory_consolidation_states%rowtype;
  app_file public.memory_files%rowtype;
  project_file public.memory_files%rowtype;
  canonical_project_id uuid;
  terminal_message_at timestamptz;
  terminal_at timestamptz := now();
  next_quiet_until timestamptz;
  next_conversation_generation bigint;
  actor_generation bigint;
  actor_job_id uuid;
  queued_job_id uuid;
  cursor_advances boolean;
  actor_cursor_advances boolean;
  app_turn_eligible boolean;
  app_enabled boolean;
  project_enabled boolean;
  pending_actor_ids uuid[];
  -- The workspace whose memory this conversation's actors learn into: a
  -- team organization, or null for Personal.
  workspace_org_id uuid;
begin
  if p_surface not in ('chat', 'word', 'tabular')
    or p_turn_id is null or p_activity_id is null
    or p_quiet_seconds < 1 or p_quiet_seconds > 3600
  then
    raise exception using errcode = '22023', message = 'invalid_memory_turn';
  end if;
  next_quiet_until := terminal_at + make_interval(secs => p_quiet_seconds);

  -- Lock the canonical source before activity/state/files. The terminal row is
  -- also verified here so a forged or failed assistant id is never scheduled.
  select locked.locked_project_id into canonical_project_id
  from public.lock_memory_conversation_source(
    p_surface, p_conversation_id, p_actor_user_id
  ) locked;
  if not found then return; end if;
  if p_surface = 'chat' then
    select message.created_at into terminal_message_at
    from public.chat_messages message
    where message.id = p_turn_id and message.chat_id = p_conversation_id
      and message.role = 'assistant' and message.content is not null
      and message.memory_input_message_id is not null
      and (
        message.author_user_id is null
        or message.author_user_id = p_actor_user_id
        or message.content @> jsonb_build_array(jsonb_build_object(
          'type', 'ask_inputs_response', 'author_user_id', p_actor_user_id
        ))
      )
    for key share;
  elsif p_surface = 'word' then
    select message.created_at into terminal_message_at
    from public.word_chat_messages message
    where message.id = p_turn_id and message.chat_id = p_conversation_id
      and message.role = 'assistant' and message.content is not null
      and message.memory_input_message_id is not null
      and (
        message.author_user_id is null
        or message.author_user_id = p_actor_user_id
        or message.content @> jsonb_build_array(jsonb_build_object(
          'type', 'ask_inputs_response', 'author_user_id', p_actor_user_id
        ))
      )
    for key share;
  else
    select message.created_at into terminal_message_at
    from public.tabular_review_chat_messages message
    where message.id = p_turn_id and message.chat_id = p_conversation_id
      and message.role = 'assistant' and message.content is not null
      and message.memory_input_message_id is not null
      and (
        message.author_user_id is null
        or message.author_user_id = p_actor_user_id
        or message.content @> jsonb_build_array(jsonb_build_object(
          'type', 'ask_inputs_response', 'author_user_id', p_actor_user_id
        ))
      )
    for key share;
  end if;
  if terminal_message_at is null then return; end if;
  if p_project_id is not null and p_project_id is distinct from canonical_project_id then
    raise exception using errcode = '22023', message = 'invalid_memory_project';
  end if;
  app_turn_eligible := public.memory_source_allows_app_memory(
    p_surface, p_conversation_id, p_actor_user_id, canonical_project_id
  );

  insert into public.memory_conversation_activity(
    surface, conversation_id, actor_user_id, quiet_until
  ) values (
    p_surface, p_conversation_id, p_actor_user_id, next_quiet_until
  ) on conflict (surface, conversation_id) do nothing;
  select * into activity from public.memory_conversation_activity current_activity
  where current_activity.surface = p_surface
    and current_activity.conversation_id = p_conversation_id
  for update;
  if not found or activity.deleted_at is not null then return; end if;

  delete from public.memory_conversation_turn_leases lease
  where lease.surface = p_surface
    and lease.conversation_id = p_conversation_id
    and lease.activity_id = p_activity_id
    and lease.actor_user_id is not distinct from p_actor_user_id;
  if not found then return; end if;
  if p_surface = 'chat' then
    update public.chat_messages message
    set memory_eligible_at = terminal_at,
        memory_app_eligible_at = case
          when app_turn_eligible then terminal_at else null end
    where message.id = p_turn_id and message.chat_id = p_conversation_id;
  elsif p_surface = 'word' then
    update public.word_chat_messages message
    set memory_eligible_at = terminal_at,
        memory_app_eligible_at = case
          when app_turn_eligible then terminal_at else null end
    where message.id = p_turn_id and message.chat_id = p_conversation_id;
  else
    update public.tabular_review_chat_messages message
    set memory_eligible_at = terminal_at,
        memory_app_eligible_at = case
          when app_turn_eligible then terminal_at else null end
    where message.id = p_turn_id and message.chat_id = p_conversation_id;
  end if;
  delete from public.memory_conversation_turn_leases lease
  where lease.surface = p_surface
    and lease.conversation_id = p_conversation_id
    and lease.expires_at <= terminal_at;

  cursor_advances := activity.latest_turn_message_at is null
    or (terminal_message_at, p_turn_id) >
       (activity.latest_turn_message_at, activity.latest_turn_id);
  next_conversation_generation := activity.generation + 1;
  update public.memory_conversation_activity current_activity
  set generation = next_conversation_generation,
      latest_turn_id = case when cursor_advances
        then p_turn_id else current_activity.latest_turn_id end,
      latest_turn_message_at = case when cursor_advances
        then terminal_message_at else current_activity.latest_turn_message_at end,
      latest_turn_completed_at = terminal_at,
      latest_turn_actor_user_id = case when cursor_advances
        then p_actor_user_id else current_activity.latest_turn_actor_user_id end,
      project_id = case
        when current_activity.project_id is distinct from canonical_project_id
          then canonical_project_id
        else current_activity.project_id
      end,
      project_curator_actor_user_id = case
        when canonical_project_id is null then null
        when p_project_id is not null then p_actor_user_id
        when current_activity.project_id is distinct from canonical_project_id then null
        else current_activity.project_curator_actor_user_id
      end,
      quiet_until = next_quiet_until,
      actor_user_id = p_actor_user_id,
      updated_at = terminal_at
  where current_activity.surface = p_surface
    and current_activity.conversation_id = p_conversation_id
  returning current_activity.* into activity;

  insert into public.memory_consolidation_states(
    surface, conversation_id, actor_user_id, project_id, source_epoch
  ) values (
    p_surface, p_conversation_id, p_actor_user_id, p_project_id,
    activity.source_epoch
  ) on conflict (surface, conversation_id, actor_user_id) do nothing;
  select * into state from public.memory_consolidation_states current_state
  where current_state.surface = p_surface
    and current_state.conversation_id = p_conversation_id
    and current_state.actor_user_id = p_actor_user_id
  for update;
  if not found then
    -- The upsert above guarantees the row; a miss means it was deleted under
    -- us. Every later statement keys on state.id, so continuing would be a
    -- silent no-op that looks exactly like "nothing to schedule".
    raise exception using errcode = 'P0001', message = 'memory_state_missing';
  end if;

  actor_cursor_advances := state.latest_terminal_message_at is null
    or (terminal_message_at, p_turn_id) >
       (state.latest_terminal_message_at, state.latest_turn_id);
  actor_generation := state.generation + 1;
  update public.memory_consolidation_states current_state
  set generation = actor_generation,
      conversation_generation = next_conversation_generation,
      source_epoch = activity.source_epoch,
      latest_turn_id = case when actor_cursor_advances
        then p_turn_id else current_state.latest_turn_id end,
      latest_terminal_message_at = case when actor_cursor_advances
        then terminal_message_at else current_state.latest_terminal_message_at end,
      latest_terminal_at = terminal_at,
      project_id = case when p_project_id is not null
        then p_project_id else current_state.project_id end,
      run_after = next_quiet_until,
      status = 'idle',
      last_error_code = null,
      updated_at = terminal_at
  where current_state.id = state.id;

  -- Extend the global quiet generation without losing any actor's most recent
  -- successful cursor. The retained project curator is also rearmed even when
  -- their app cursor was already processed, so a viewer's later project turn
  -- can still be learned by a currently-authorized editor.
  update public.memory_consolidation_states rearmed
  set generation = rearmed.generation + 1,
      conversation_generation = next_conversation_generation,
      source_epoch = activity.source_epoch,
      run_after = next_quiet_until,
      status = 'idle',
      last_error_code = null,
      updated_at = terminal_at
  where rearmed.surface = p_surface
    and rearmed.conversation_id = p_conversation_id
    and rearmed.id <> state.id
    and rearmed.latest_turn_id is not null
    and (
      rearmed.processed_generation < rearmed.generation
      or rearmed.actor_user_id = activity.project_curator_actor_user_id
    );

  workspace_org_id := public.memory_source_org_id(p_surface, p_conversation_id);
  perform public.ensure_user_memory_file(pending.actor_user_id, workspace_org_id)
  from (
    select distinct candidate.actor_user_id
    from public.memory_consolidation_states candidate
    where candidate.surface = p_surface
      and candidate.conversation_id = p_conversation_id
      and candidate.latest_turn_id is not null
      and candidate.processed_generation < candidate.generation
  ) pending;
  if activity.project_id is not null then
    insert into public.memory_files(scope, project_id, enabled)
    values ('project', activity.project_id, false)
    on conflict do nothing;
  end if;

  -- Lock every file this turn may touch, in id order, through the unique
  -- indexes. The obvious "user_id in (subquery) or project_id = ..." shape
  -- cannot use either index under a top-level OR and scanned (and row
  -- locked) the whole table on every assistant turn.
  select coalesce(array_agg(distinct pending.actor_user_id), '{}')
  into pending_actor_ids
  from public.memory_consolidation_states pending
  where pending.surface = p_surface
    and pending.conversation_id = p_conversation_id
    and pending.latest_turn_id is not null
    and pending.processed_generation < pending.generation;
  perform memory_file.id
  from public.memory_files memory_file
  where memory_file.id in (
      select locked_user_file.id from public.memory_files locked_user_file
      where locked_user_file.scope = 'user'
        and locked_user_file.user_id = any(pending_actor_ids)
        and locked_user_file.org_id is not distinct from workspace_org_id
      union all
      select locked_project_file.id
      from public.memory_files locked_project_file
      where locked_project_file.scope = 'project'
        and locked_project_file.project_id = activity.project_id
    )
  order by memory_file.id
  for update;

  for queued_state in
    select pending.* from public.memory_consolidation_states pending
    where pending.surface = p_surface
      and pending.conversation_id = p_conversation_id
      and pending.latest_turn_id is not null
      and pending.processed_generation < pending.generation
    order by pending.actor_user_id, pending.id
    for update
  loop
    select * into app_file from public.memory_files memory_file
    where memory_file.scope = 'user'
      and memory_file.user_id = queued_state.actor_user_id
      and memory_file.org_id is not distinct from workspace_org_id;
    app_enabled := coalesce(app_file.enabled, false)
      and public.memory_source_allows_app_memory(
        p_surface, p_conversation_id, queued_state.actor_user_id,
        activity.project_id
      );
    project_enabled := false;
    if activity.project_id is not null
      and queued_state.actor_user_id = activity.project_curator_actor_user_id
      and queued_state.project_id = activity.project_id
    then
      select * into project_file from public.memory_files memory_file
      where memory_file.scope = 'project'
        and memory_file.project_id = activity.project_id;
      project_enabled := coalesce(project_file.enabled, false);
    end if;

    if not app_enabled and not project_enabled then
      update public.memory_consolidation_states finished_state
      set processed_generation = queued_state.generation,
          status = 'idle', updated_at = terminal_at
      where finished_state.id = queued_state.id;
      continue;
    end if;

    queued_job_id := gen_random_uuid();
    insert into public.db_jobs(
      id, kind, payload, max_attempts, run_at, dedupe_key
    ) values (
      queued_job_id,
      'memory.consolidate',
      jsonb_build_object(
        'stateId', queued_state.id,
        'generation', queued_state.generation,
        'surface', queued_state.surface,
        'conversationId', queued_state.conversation_id,
        'actorUserId', queued_state.actor_user_id,
        'projectId', queued_state.project_id,
        'turnId', queued_state.latest_turn_id,
        'terminalAt', queued_state.latest_terminal_at,
        'projectTurnId', activity.latest_turn_id,
        'projectTerminalAt', activity.latest_turn_completed_at,
        'conversationGeneration', next_conversation_generation,
        'sourceEpoch', queued_state.source_epoch,
        'appEpoch', case when app_enabled then app_file.epoch else null end,
        'appOrgId', case when app_enabled then app_file.org_id else null end,
        'projectEpoch', case when project_enabled then project_file.epoch else null end
      ),
      5,
      next_quiet_until,
      'memory:' || queued_state.id::text || ':' ||
        queued_state.generation::text || ':' || next_conversation_generation::text
    );
    update public.memory_consolidation_states scheduled_state
    set status = 'scheduled', updated_at = terminal_at
    where scheduled_state.id = queued_state.id;
    if app_enabled then
      update public.memory_files memory_file
      set status = case when memory_file.status = 'processing'
        then memory_file.status else 'scheduled' end
      where memory_file.id = app_file.id;
    end if;
    if project_enabled then
      update public.memory_files memory_file
      set status = case when memory_file.status = 'processing'
        then memory_file.status else 'scheduled' end
      where memory_file.id = project_file.id;
    end if;
    if queued_state.id = state.id then actor_job_id := queued_job_id; end if;
  end loop;

  if actor_job_id is not null then
    return query select actor_job_id, actor_generation;
  end if;
end;
$$;

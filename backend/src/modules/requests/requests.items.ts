/**
 * The requests of a retainer matter: list, read, create and change. Every
 * change is one optimistic-concurrency update (`version`) followed by its
 * insert-only events; nothing is ever deleted, a request ends as closed or
 * cancelled. Nothing here records time worked.
 */

import type {
  MatterRequestDetail,
  MatterRequestEvent,
  MatterRequestList,
} from "@mike/contracts";
import {
  authorizeMatterMember,
  type MatterAccess,
} from "../matters/matters.service";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { listAssignees } from "./requests.assignees";
import { loadRequestEvents, recordRequestEvent } from "./requests.events";
import { loadRounds } from "./requests.rounds";
import {
  ASSIGNEE_NOT_ELIGIBLE_CODE,
  INVALID_REQUEST_CODE,
  MAX_REQUESTS_LISTED,
  NOT_A_RETAINER_CODE,
  parseCreate,
  parsePatch,
  REQUEST_COLUMNS,
  TERMINAL_STATUSES,
  today,
  toRequest,
  toType,
  TYPE_NOT_AVAILABLE_CODE,
  VERSION_CONFLICT_CODE,
  type RequestRow,
} from "./requests.shared";
import { loadTypes } from "./requests.types";

type Actor = {
  userId: string;
  userEmail?: string | null;
  projectId: unknown;
  matterId: unknown;
};

const NOT_FOUND = "Not found";

async function roundCounts(db: Db, requestIds: string[]): Promise<ServiceResult<Map<string, number>>> {
  const counts = new Map<string, Set<number>>();
  if (requestIds.length === 0) return ok(new Map());
  const { data, error } = await db
    .from("matter_request_rounds")
    .select("request_id, round_number")
    .in("request_id", requestIds);
  if (error) return internalFailure(error);
  for (const row of (data ?? []) as unknown as { request_id: string; round_number: number }[]) {
    const set = counts.get(row.request_id) ?? new Set<number>();
    set.add(row.round_number);
    counts.set(row.request_id, set);
  }
  return ok(new Map([...counts].map(([id, set]) => [id, set.size])));
}

export async function listMatterRequests(
  db: Db,
  actor: Actor,
): Promise<ServiceResult<MatterRequestList>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    const { matterId, organizationId, canWrite, isRetainer, role } = access.data;
    const base = { retainer: isRetainer, can_manage_retainer: role === "matter_owner" };
    if (!isRetainer)
      return ok({ ...base, requests: [], types: [], assignees: [], can_write: false });
    const types = await loadTypes(db, organizationId);
    if (!types.ok) return types;
    const { data, error } = await db
      .from("matter_requests")
      .select(REQUEST_COLUMNS)
      .eq("matter_id", matterId)
      .order("received_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_REQUESTS_LISTED);
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as RequestRow[];
    const counts = await roundCounts(db, rows.map((row) => row.id));
    if (!counts.ok) return counts;
    const assignees = canWrite
      ? await listAssignees(db, { matterId, organizationId })
      : ok([]);
    if (!assignees.ok) return assignees;
    return ok({
      ...base,
      requests: rows.map((row) => toRequest(row, counts.data.get(row.id) ?? 0)),
      types: types.data.map(toType),
      assignees: assignees.data,
      can_write: canWrite,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

async function loadOne(
  db: Db,
  matterId: string,
  requestId: unknown,
): Promise<ServiceResult<RequestRow>> {
  if (typeof requestId !== "string" || !isUuid(requestId)) return failure("not_found", NOT_FOUND);
  const { data, error } = await db
    .from("matter_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", requestId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (error) return internalFailure(error);
  return data ? ok(data as unknown as RequestRow) : failure("not_found", NOT_FOUND);
}

async function detail(db: Db, row: RequestRow): Promise<ServiceResult<MatterRequestDetail>> {
  const [rounds, events] = await Promise.all([loadRounds(db, row.id), loadRequestEvents(db, row.id)]);
  if (!rounds.ok) return rounds;
  if (!events.ok) return events;
  const distinct = new Set(rounds.data.map((round) => round.round_number)).size;
  return ok({ ...toRequest(row, distinct), rounds: rounds.data, events: events.data });
}

export async function getMatterRequest(
  db: Db,
  actor: Actor & { requestId: unknown },
): Promise<ServiceResult<MatterRequestDetail>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    if (!access.data.isRetainer) return failure("not_found", NOT_FOUND);
    const row = await loadOne(db, access.data.matterId, actor.requestId);
    if (!row.ok) return row;
    return detail(db, row.data);
  } catch (error) {
    return internalFailure(error);
  }
}

/** The type must belong to the matter's firm; a new choice must be active. */
async function checkType(
  db: Db,
  organizationId: string,
  typeId: string,
): Promise<ServiceResult<null>> {
  const types = await loadTypes(db, organizationId);
  if (!types.ok) return types;
  const type = types.data.find((row) => row.id === typeId);
  if (!type || type.archived_at)
    return failure("validation", "That request type is not available.", TYPE_NOT_AVAILABLE_CODE);
  return ok(null);
}

async function checkAssignee(
  db: Db,
  access: MatterAccess,
  userId: string,
): Promise<ServiceResult<null>> {
  const people = await listAssignees(db, {
    matterId: access.matterId,
    organizationId: access.organizationId,
  });
  if (!people.ok) return people;
  if (!people.data.some((person) => person.user_id === userId))
    return failure(
      "validation",
      "Only an owner or editor of the matter can be assigned.",
      ASSIGNEE_NOT_ELIGIBLE_CODE,
    );
  return ok(null);
}

async function writableRetainer(db: Db, actor: Actor): Promise<ServiceResult<MatterAccess>> {
  const access = await authorizeMatterMember(db, { ...actor, write: true });
  if (!access.ok) return access;
  if (!access.data.isRetainer)
    return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
  return access;
}

export async function createMatterRequest(
  db: Db,
  actor: Actor & { body: unknown },
): Promise<ServiceResult<MatterRequestDetail>> {
  try {
    const access = await writableRetainer(db, actor);
    if (!access.ok) return access;
    const parsed = parseCreate(actor.body);
    if (!parsed.ok) return failure("validation", parsed.detail, INVALID_REQUEST_CODE);
    const input = parsed.value;
    const type = await checkType(db, access.data.organizationId, input.typeId);
    if (!type.ok) return type;
    if (input.assigneeUserId) {
      const eligible = await checkAssignee(db, access.data, input.assigneeUserId);
      if (!eligible.ok) return eligible;
    }
    const { data, error } = await db
      .from("matter_requests")
      .insert({
        matter_id: access.data.matterId,
        type_id: input.typeId,
        title: input.title,
        complexity: input.complexity,
        status: "received",
        version: 1,
        received_on: input.receivedOn ?? today(),
        assignee_user_id: input.assigneeUserId,
        assignee_level: input.assigneeLevel,
        created_by: actor.userId,
      })
      .select(REQUEST_COLUMNS)
      .single();
    if (error || !data) return internalFailure(error);
    const row = data as unknown as RequestRow;
    const created = await recordRequestEvent(db, {
      requestId: row.id,
      matterId: row.matter_id,
      actorUserId: actor.userId,
      action: "created",
      detail: { type_id: row.type_id, complexity: row.complexity, status: row.status },
    });
    if (!created.ok) return created;
    if (row.assignee_user_id) {
      const assigned = await recordRequestEvent(db, {
        requestId: row.id,
        matterId: row.matter_id,
        actorUserId: actor.userId,
        action: "assigned",
        detail: { assignee_user_id: row.assignee_user_id, assignee_level: row.assignee_level },
      });
      if (!assigned.ok) return assigned;
    }
    return detail(db, row);
  } catch (error) {
    return internalFailure(error);
  }
}

export async function updateMatterRequest(
  db: Db,
  actor: Actor & { requestId: unknown; body: unknown },
): Promise<ServiceResult<MatterRequestDetail>> {
  try {
    const access = await writableRetainer(db, actor);
    if (!access.ok) return access;
    const parsed = parsePatch(actor.body);
    if (!parsed.ok) return failure("validation", parsed.detail, INVALID_REQUEST_CODE);
    const patch = parsed.value;
    const current = await loadOne(db, access.data.matterId, actor.requestId);
    if (!current.ok) return current;
    const row = current.data;
    if (row.version !== patch.version)
      return failure("conflict", "The request changed since you read it.", VERSION_CONFLICT_CODE);

    const changes: Record<string, unknown> = {};
    const edited: string[] = [];
    const events: { action: MatterRequestEvent["action"]; detail: Record<string, unknown> }[] = [];

    if (patch.title !== undefined && patch.title !== row.title) {
      changes.title = patch.title;
      edited.push("title");
    }
    if (patch.typeId !== undefined && patch.typeId !== row.type_id) {
      const type = await checkType(db, access.data.organizationId, patch.typeId);
      if (!type.ok) return type;
      changes.type_id = patch.typeId;
      edited.push("type");
    }
    if (patch.complexity !== undefined && patch.complexity !== row.complexity) {
      changes.complexity = patch.complexity;
      edited.push("complexity");
    }
    const receivedOn = patch.receivedOn ?? row.received_on;
    if (receivedOn !== row.received_on) {
      changes.received_on = receivedOn;
      edited.push("received_on");
    }

    // Status and the closing date travel together: a terminal state has a
    // closing date, any other has none.
    const status = patch.status ?? row.status;
    let closedOn: string | null = row.closed_on;
    if (TERMINAL_STATUSES.has(status)) {
      if (patch.closedOn !== undefined) closedOn = patch.closedOn;
      else if (!TERMINAL_STATUSES.has(row.status)) closedOn = today() < receivedOn ? receivedOn : today();
    } else {
      if (patch.closedOn !== undefined)
        return failure("validation", "closed_on needs a closed or cancelled request.", INVALID_REQUEST_CODE);
      closedOn = null;
    }
    if (closedOn !== null && closedOn < receivedOn)
      return failure("validation", "closed_on cannot be before received_on.", INVALID_REQUEST_CODE);
    if (status !== row.status) {
      changes.status = status;
      events.push({ action: "status_changed", detail: { from: row.status, to: status } });
    }
    if (closedOn !== row.closed_on) {
      changes.closed_on = closedOn;
      if (status === row.status) edited.push("closed_on");
    }

    if (patch.assignee !== undefined) {
      const { userId, level } = patch.assignee;
      if (userId !== row.assignee_user_id || level !== row.assignee_level) {
        if (userId) {
          const eligible = await checkAssignee(db, access.data, userId);
          if (!eligible.ok) return eligible;
        }
        changes.assignee_user_id = userId;
        changes.assignee_level = level;
        events.push(
          userId
            ? { action: "assigned", detail: { assignee_user_id: userId, assignee_level: level } }
            : { action: "unassigned", detail: { previous_assignee_user_id: row.assignee_user_id } },
        );
      }
    }
    if (edited.length > 0) events.unshift({ action: "edited", detail: { fields: edited } });
    if (Object.keys(changes).length === 0) return detail(db, row);

    const { data, error } = await db
      .from("matter_requests")
      .update({ ...changes, version: row.version + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("matter_id", row.matter_id)
      .eq("version", row.version)
      .select(REQUEST_COLUMNS)
      .maybeSingle();
    if (error) return internalFailure(error);
    if (!data)
      return failure("conflict", "The request changed since you read it.", VERSION_CONFLICT_CODE);
    const updated = data as unknown as RequestRow;
    for (const event of events) {
      const recorded = await recordRequestEvent(db, {
        requestId: updated.id,
        matterId: updated.matter_id,
        actorUserId: actor.userId,
        ...event,
      });
      if (!recorded.ok) return recorded;
    }
    return detail(db, updated);
  } catch (error) {
    return internalFailure(error);
  }
}

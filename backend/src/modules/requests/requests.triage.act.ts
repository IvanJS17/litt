/**
 * What a lawyer does with Donna's triage: ask for a new run, and accept, edit
 * or discard each proposed item. Owner or editor of the matter only, and never
 * a person in training (they read the card, they do not decide on it).
 *
 * Accepting or editing a type or a complexity changes the request through the
 * same optimistic-concurrency update as any edit (`version`, 409 on a stale
 * one). An urgency or a candidate is recorded as the lawyer's decision and
 * nothing more: the card never assigns anybody. A draft accepted or edited is
 * the lawyer's own text in the decision row. Decisions are insert-only and one
 * per item; the events record the decision and the item, never the text.
 */

import type { MatterRequestComplexity, TriageCard, TriageDecisionInput, TriageUrgency } from "@mike/contracts";
import { failure, internalFailure, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { authorizeMatterMember } from "../matters/matters.service";
import { listAssignees } from "./requests.assignees";
import { recordRequestEvent } from "./requests.events";
import { updateMatterRequest } from "./requests.items";
import { isComplexity, isRecord, NOT_A_RETAINER_CODE, uuidOrNull } from "./requests.shared";
import { getTriageCard, isTraineeIn, latestRun } from "./requests.triage.read";
import { executeTriage, type TriageDeps } from "./requests.triage.run";
import {
  DRAFT_TEXT_MAX,
  INVALID_TRIAGE_DECISION_CODE,
  TRIAGE_ITEM_DECIDED_CODE,
  TRIAGE_ITEM_OBSOLETE_CODE,
  TRIAGE_TRAINEE_CODE,
  URGENCY_LEVELS,
} from "./requests.triage.shared";

type Actor = { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown; requestId: unknown };

const NOT_FOUND = "Not found";

async function writer(db: Db, actor: Actor) {
  const access = await authorizeMatterMember(db, { ...actor, write: true });
  if (!access.ok) return access;
  if (await isTraineeIn(db, actor.userId, access.data.organizationId, access.data.projectId))
    return failure("forbidden", "People in training cannot run or decide Donna's triage.", TRIAGE_TRAINEE_CODE);
  if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
  if (typeof actor.requestId !== "string" || !isUuid(actor.requestId)) return failure("not_found", NOT_FOUND);
  return access;
}

/** `POST …/requests/:requestId/triage`: a new run, at the lawyer's click. It counts against the month's cap. */
export async function runTriageNow(
  db: Db,
  actor: Actor,
  deps: TriageDeps = {},
): Promise<ServiceResult<TriageCard>> {
  try {
    const access = await writer(db, actor);
    if (!access.ok) return access;
    const requestId = actor.requestId as string;
    const result = await executeTriage(
      db,
      {
        userId: actor.userId,
        userEmail: actor.userEmail,
        orgId: access.data.organizationId,
        projectId: access.data.projectId,
        matterId: access.data.matterId,
        requestId,
        trigger: "manual",
      },
      deps,
    );
    if (!result.ok) return result;
    return getTriageCard(db, actor);
  } catch (error) {
    return internalFailure(error);
  }
}

type ItemRow = {
  id: string;
  run_id: string;
  kind: string;
  value_type_id: string | null;
  value_enum: string | null;
  value_user_id: string | null;
};

function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text !== "" && [...text].length <= max ? text : null;
}

const DECISION_KEYS = new Set(["action", "version", "type_id", "complexity", "urgency", "user_id", "text", "purpose"]);

function invalid(detail: string) {
  return failure("validation", detail, INVALID_TRIAGE_DECISION_CODE);
}

/** `POST …/requests/:requestId/triage/items/:itemId/decision`. */
export async function decideTriageItem(
  db: Db,
  actor: Actor & { itemId: unknown; body: unknown },
): Promise<ServiceResult<TriageCard>> {
  try {
    const access = await writer(db, actor);
    if (!access.ok) return access;
    const requestId = actor.requestId as string;
    const body = actor.body;
    if (!isRecord(body)) return invalid("A request body is required.");
    for (const key of Object.keys(body)) if (!DECISION_KEYS.has(key)) return invalid(`${key} is not part of a decision.`);
    const input = body as TriageDecisionInput;
    if (input.action !== "accepted" && input.action !== "edited" && input.action !== "discarded")
      return invalid("action must be accepted, edited or discarded.");
    if (typeof actor.itemId !== "string" || !isUuid(actor.itemId)) return failure("not_found", NOT_FOUND);

    const { data: itemData, error: itemError } = await db
      .from("matter_request_triage_items")
      .select("id, run_id, kind, value_type_id, value_enum, value_user_id")
      .eq("id", actor.itemId)
      .eq("request_id", requestId)
      .eq("matter_id", access.data.matterId)
      .maybeSingle();
    if (itemError) return internalFailure(itemError);
    if (!itemData) return failure("not_found", NOT_FOUND);
    const item = itemData as unknown as ItemRow;

    // Only what the latest run proposes can be decided; an earlier run's items are history.
    const latest = await latestRun(db, requestId);
    if (!latest.ok) return latest;
    if (latest.data?.id !== item.run_id)
      return failure("conflict", "That proposal belongs to an earlier run.", TRIAGE_ITEM_OBSOLETE_CODE);
    const { data: earlier, error: earlierError } = await db
      .from("matter_request_triage_decisions")
      .select("id")
      .eq("item_id", item.id)
      .limit(1);
    if (earlierError) return internalFailure(earlierError);
    if ((earlier ?? []).length > 0)
      return failure("conflict", "That proposal was already decided.", TRIAGE_ITEM_DECIDED_CODE);

    const decision: Record<string, unknown> = {};
    // What would change in the request, if anything.
    let patch: { type_id?: string; complexity?: MatterRequestComplexity } | null = null;

    if (input.action !== "discarded") {
      if (item.kind === "type") {
        const typeId = input.action === "edited" ? uuidOrNull(input.type_id) : item.value_type_id;
        if (!typeId) return invalid("type_id must be a request type id.");
        if (input.action === "edited") decision.edited_type_id = typeId;
        patch = { type_id: typeId };
      } else if (item.kind === "complexity") {
        const complexity = input.action === "edited" ? input.complexity : item.value_enum;
        if (!isComplexity(complexity)) return invalid("complexity must be routine, standard or complex.");
        if (input.action === "edited") decision.edited_enum = complexity;
        patch = { complexity };
      } else if (item.kind === "urgency") {
        if (input.action === "edited") {
          if (!URGENCY_LEVELS.includes(input.urgency as TriageUrgency)) return invalid("urgency must be low, normal or urgent.");
          decision.edited_enum = input.urgency;
        }
      } else if (item.kind === "candidate") {
        if (input.action === "edited") {
          const userId = uuidOrNull(input.user_id);
          const people = await listAssignees(db, { matterId: access.data.matterId, organizationId: access.data.organizationId });
          if (!people.ok) return people;
          if (!userId || !people.data.some((person) => person.user_id === userId))
            return invalid("user_id must be someone on the matter's team.");
          decision.edited_user_id = userId;
        }
      } else if (input.action === "edited") {
        const text = line(input.text, DRAFT_TEXT_MAX);
        if (!text) return invalid(`text must be 1 to ${DRAFT_TEXT_MAX} characters.`);
        decision.edited_text = text;
        if (item.kind === "document") {
          const purpose = line(input.purpose, DRAFT_TEXT_MAX);
          if (!purpose) return invalid(`purpose must be 1 to ${DRAFT_TEXT_MAX} characters.`);
          decision.edited_purpose = purpose;
        }
      }
    }

    if (patch) {
      if (typeof input.version !== "number" || !Number.isSafeInteger(input.version) || input.version < 1)
        return invalid("version is required to change the request.");
      const changed = await updateMatterRequest(db, {
        userId: actor.userId,
        userEmail: actor.userEmail,
        projectId: actor.projectId,
        matterId: actor.matterId,
        requestId,
        body: { version: input.version, ...patch },
      });
      if (!changed.ok) return changed;
    }

    const { error } = await db.from("matter_request_triage_decisions").insert({
      item_id: item.id,
      request_id: requestId,
      matter_id: access.data.matterId,
      org_id: access.data.organizationId,
      actor_user_id: actor.userId,
      action: input.action,
      ...decision,
    });
    if (error) return internalFailure(error);
    await recordRequestEvent(db, {
      requestId,
      matterId: access.data.matterId,
      actorUserId: actor.userId,
      action: input.action === "accepted" ? "triage_accepted" : input.action === "edited" ? "triage_edited" : "triage_discarded",
      detail: { item_id: item.id, kind: item.kind, run_id: item.run_id },
    });
    return getTriageCard(db, actor);
  } catch (error) {
    return internalFailure(error);
  }
}

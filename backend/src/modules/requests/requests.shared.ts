/**
 * Vocabulary, input parsing and row mapping shared by the topic files of the
 * requests module (a retainer matter's requests: docs/matter-requests.md).
 *
 * Nothing here measures time worked: a request has dates and a round count,
 * never hours or an estimate.
 */

import type {
  MatterRequest,
  MatterRequestComplexity,
  MatterRequestEvent,
  MatterRequestLevel,
  MatterRequestStatus,
  MatterRequestType,
  MatterRequestTypeSeed,
} from "@mike/contracts";
import { isUuid } from "../../lib/uuid";

export const REQUEST_STATUSES: readonly MatterRequestStatus[] = [
  "received",
  "in_review",
  "with_client",
  "with_counterparty",
  "closed",
  "cancelled",
];
export const REQUEST_COMPLEXITIES: readonly MatterRequestComplexity[] = [
  "routine",
  "standard",
  "complex",
];
export const REQUEST_LEVELS: readonly MatterRequestLevel[] = [
  "apprentice",
  "junior",
  "senior",
  "partner",
];
export const TYPE_SEEDS: readonly MatterRequestTypeSeed[] = [
  "contracts_clients",
  "contracts_suppliers",
  "intellectual_property",
  "shareholder_meetings",
  "corporate_books",
  "other",
];
export const TERMINAL_STATUSES: ReadonlySet<MatterRequestStatus> = new Set(["closed", "cancelled"]);

export const TITLE_MAX = 160;
export const TYPE_NAME_MAX = 80;
export const MAX_ROUND_NUMBER = 99;
export const MAX_TYPES_PER_ORG = 60;
export const MAX_REQUESTS_LISTED = 1000;

export const VERSION_CONFLICT_CODE = "request_version_conflict";
export const NOT_A_RETAINER_CODE = "matter_not_retainer";
export const ASSIGNEE_NOT_ELIGIBLE_CODE = "assignee_not_eligible";
export const ASSIGNEE_LEVEL_REQUIRED_CODE = "assignee_level_required";
export const INVALID_REQUEST_CODE = "invalid_request";
export const TYPE_NOT_AVAILABLE_CODE = "request_type_not_available";
export const TYPE_NAME_TAKEN_CODE = "request_type_name_taken";
export const TYPE_LIMIT_CODE = "request_type_limit";
export const VERSION_NOT_IN_MATTER_CODE = "version_not_in_matter";
export const ROUND_ALREADY_LINKED_CODE = "round_already_linked";

export const REQUEST_COLUMNS =
  "id, matter_id, type_id, title, complexity, status, assignee_user_id, assignee_level, received_on, closed_on, version, created_at, updated_at";

export type RequestRow = {
  id: string;
  matter_id: string;
  type_id: string;
  title: string;
  complexity: MatterRequestComplexity;
  status: MatterRequestStatus;
  assignee_user_id: string | null;
  assignee_level: MatterRequestLevel | null;
  received_on: string;
  closed_on: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export function toRequest(row: RequestRow, roundCount: number): MatterRequest {
  return { ...row, round_count: roundCount };
}

export type EventRow = {
  id: string;
  actor_user_id: string | null;
  action: MatterRequestEvent["action"];
  detail: Record<string, unknown> | null;
  created_at: string;
};

export function toEvent(row: EventRow): MatterRequestEvent {
  return { ...row, detail: row.detail ?? {} };
}

export type TypeRow = {
  id: string;
  seed_key: MatterRequestTypeSeed | null;
  name: string | null;
  sort_order: number;
  archived_at: string | null;
};

export const TYPE_COLUMNS = "id, seed_key, name, sort_order, archived_at";

export function toType(row: TypeRow): MatterRequestType {
  return {
    id: row.id,
    seed_key: row.seed_key,
    name: row.name,
    sort_order: row.sort_order,
    archived: row.archived_at !== null,
  };
}

/** Today's date where the firms are (Mexico City), as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStatus(value: unknown): value is MatterRequestStatus {
  return typeof value === "string" && (REQUEST_STATUSES as readonly string[]).includes(value);
}
export function isComplexity(value: unknown): value is MatterRequestComplexity {
  return typeof value === "string" && (REQUEST_COMPLEXITIES as readonly string[]).includes(value);
}
export function isLevel(value: unknown): value is MatterRequestLevel {
  return typeof value === "string" && (REQUEST_LEVELS as readonly string[]).includes(value);
}

/** A title or a name: trimmed, 1..max characters (code points). */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const length = [...text].length;
  return length >= 1 && length <= max ? text : null;
}

export function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value : null;
}

export type ParsedCreate = {
  title: string;
  typeId: string;
  complexity: MatterRequestComplexity;
  receivedOn: string | null;
  assigneeUserId: string | null;
  assigneeLevel: MatterRequestLevel | null;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

export function parseCreate(body: unknown): Parsed<ParsedCreate> {
  if (!isRecord(body)) return { ok: false, detail: "A request body is required." };
  const title = cleanText(body.title, TITLE_MAX);
  if (!title) return { ok: false, detail: `title is required (1 to ${TITLE_MAX} characters).` };
  const typeId = uuidOrNull(body.type_id);
  if (!typeId) return { ok: false, detail: "type_id must be a request type id." };
  if (!isComplexity(body.complexity))
    return { ok: false, detail: "complexity must be routine, standard or complex." };
  if (body.received_on != null && !isIsoDate(body.received_on))
    return { ok: false, detail: "received_on must be a date (YYYY-MM-DD)." };
  const assignee = parseAssignee(body);
  if (!assignee.ok) return assignee;
  return {
    ok: true,
    value: {
      title,
      typeId,
      complexity: body.complexity,
      receivedOn: (body.received_on as string | undefined) ?? null,
      ...assignee.value,
    },
  };
}

function parseAssignee(
  body: Record<string, unknown>,
): Parsed<{ assigneeUserId: string | null; assigneeLevel: MatterRequestLevel | null }> {
  const rawUser = body.assignee_user_id;
  const rawLevel = body.assignee_level;
  if (rawUser == null) {
    if (rawLevel != null)
      return { ok: false, detail: "assignee_level needs an assignee_user_id." };
    return { ok: true, value: { assigneeUserId: null, assigneeLevel: null } };
  }
  const user = uuidOrNull(rawUser);
  if (!user) return { ok: false, detail: "assignee_user_id must be a user id." };
  if (!isLevel(rawLevel))
    return { ok: false, detail: "assignee_level must be apprentice, junior, senior or partner." };
  return { ok: true, value: { assigneeUserId: user, assigneeLevel: rawLevel } };
}

export type ParsedPatch = {
  version: number;
  title?: string;
  typeId?: string;
  complexity?: MatterRequestComplexity;
  status?: MatterRequestStatus;
  receivedOn?: string;
  closedOn?: string;
  /** Present (even as null) when the assignment is part of the change. */
  assignee?: { userId: string | null; level: MatterRequestLevel | null };
};

const PATCH_KEYS = new Set([
  "version",
  "title",
  "type_id",
  "complexity",
  "status",
  "received_on",
  "closed_on",
  "assignee_user_id",
  "assignee_level",
]);

export function parsePatch(body: unknown): Parsed<ParsedPatch> {
  if (!isRecord(body)) return { ok: false, detail: "A request body is required." };
  for (const key of Object.keys(body))
    if (!PATCH_KEYS.has(key)) return { ok: false, detail: `${key} cannot be changed here.` };
  if (typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 1)
    return { ok: false, detail: "version is required." };
  const patch: ParsedPatch = { version: body.version };
  if ("title" in body) {
    const title = cleanText(body.title, TITLE_MAX);
    if (!title) return { ok: false, detail: `title must be 1 to ${TITLE_MAX} characters.` };
    patch.title = title;
  }
  if ("type_id" in body) {
    const typeId = uuidOrNull(body.type_id);
    if (!typeId) return { ok: false, detail: "type_id must be a request type id." };
    patch.typeId = typeId;
  }
  if ("complexity" in body) {
    if (!isComplexity(body.complexity))
      return { ok: false, detail: "complexity must be routine, standard or complex." };
    patch.complexity = body.complexity;
  }
  if ("status" in body) {
    if (!isStatus(body.status)) return { ok: false, detail: "status is not a request state." };
    patch.status = body.status;
  }
  if ("received_on" in body) {
    if (!isIsoDate(body.received_on))
      return { ok: false, detail: "received_on must be a date (YYYY-MM-DD)." };
    patch.receivedOn = body.received_on;
  }
  if ("closed_on" in body) {
    if (!isIsoDate(body.closed_on))
      return { ok: false, detail: "closed_on must be a date (YYYY-MM-DD)." };
    patch.closedOn = body.closed_on;
  }
  if ("assignee_user_id" in body || "assignee_level" in body) {
    const assignee = parseAssignee(body);
    if (!assignee.ok) return assignee;
    patch.assignee = {
      userId: assignee.value.assigneeUserId,
      level: assignee.value.assigneeLevel,
    };
  }
  return { ok: true, value: patch };
}

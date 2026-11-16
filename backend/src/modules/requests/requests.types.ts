/**
 * The firm's catalog of request types (Settings > firm). Every member of a team
 * organization reads it; only an owner or admin edits it. A firm that has
 * never opened it gets the default types, created on first read. A type that
 * requests use is archived, never deleted.
 */

import type { MatterRequestType, MatterRequestTypeList } from "@mike/contracts";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { isPersonalOrg } from "../../lib/personalOrgs";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import {
  cleanText,
  INVALID_REQUEST_CODE,
  isRecord,
  MAX_TYPES_PER_ORG,
  TYPE_COLUMNS,
  TYPE_LIMIT_CODE,
  TYPE_NAME_MAX,
  TYPE_NAME_TAKEN_CODE,
  TYPE_SEEDS,
  toType,
  type TypeRow,
} from "./requests.shared";

type Actor = { userId: string; userEmail?: string | null; orgId: unknown };

const NOT_FOUND = "Not found";
const UNIQUE_VIOLATION = "23505";

function pgCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

type Member = { orgId: string; admin: boolean };

/** The caller as a member of a team organization, or the 404. */
export async function teamMember(db: Db, actor: Actor): Promise<ServiceResult<Member>> {
  if (typeof actor.orgId !== "string" || !isUuid(actor.orgId)) return failure("not_found", NOT_FOUND);
  try {
    if (await isPersonalOrg(db, actor.orgId)) return failure("not_found", NOT_FOUND);
    const role = await getOrgRole(actor.userId, actor.orgId, db);
    if (!role) return failure("not_found", NOT_FOUND);
    return ok({ orgId: actor.orgId, admin: isOrgAdmin(role) });
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * Every type of the firm, archived ones included, creating the defaults the
 * firm lacks. Two first readers racing each other make the loser's insert fail
 * the unique index; it then simply reads what the winner wrote.
 */
export async function loadTypes(db: Db, orgId: string): Promise<ServiceResult<TypeRow[]>> {
  const read = async () =>
    db
      .from("matter_request_types")
      .select(TYPE_COLUMNS)
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
  let { data, error } = await read();
  if (error) return internalFailure(error);
  let rows = (data ?? []) as unknown as TypeRow[];
  const have = new Set(rows.map((row) => row.seed_key).filter(Boolean));
  if (rows.length === 0) {
    const missing = TYPE_SEEDS.filter((seed) => !have.has(seed));
    const { error: insertError } = await db.from("matter_request_types").insert(
      missing.map((seed_key, index) => ({
        organization_id: orgId,
        seed_key,
        sort_order: (index + 1) * 10,
      })),
    );
    if (insertError && pgCode(insertError) !== UNIQUE_VIOLATION) return internalFailure(insertError);
    ({ data, error } = await read());
    if (error) return internalFailure(error);
    rows = (data ?? []) as unknown as TypeRow[];
  }
  return ok(rows);
}

export async function listRequestTypes(db: Db, actor: Actor): Promise<ServiceResult<MatterRequestTypeList>> {
  const who = await teamMember(db, actor);
  if (!who.ok) return who;
  const rows = await loadTypes(db, who.data.orgId);
  if (!rows.ok) return rows;
  return ok({ types: rows.data.map(toType), can_manage: who.data.admin });
}

async function manager(db: Db, actor: Actor): Promise<ServiceResult<Member>> {
  const who = await teamMember(db, actor);
  if (!who.ok) return who;
  if (!who.data.admin)
    return failure("forbidden", "Only an owner or admin edits the request types.", "org_admin_required");
  return who;
}

function audit(db: Db, actor: Actor, orgId: string, action: string, typeId: string) {
  return recordAudit(db, {
    userId: actor.userId,
    userEmail: actor.userEmail ?? null,
    orgId,
    action,
    surface: "organization",
    detail: { org_id: orgId, request_type_id: typeId },
  });
}

export async function createRequestType(
  db: Db,
  actor: Actor & { body: unknown },
): Promise<ServiceResult<MatterRequestType>> {
  const who = await manager(db, actor);
  if (!who.ok) return who;
  const name = isRecord(actor.body) ? cleanText(actor.body.name, TYPE_NAME_MAX) : null;
  if (!name)
    return failure("validation", `name is required (1 to ${TYPE_NAME_MAX} characters).`, INVALID_REQUEST_CODE);
  const rows = await loadTypes(db, who.data.orgId);
  if (!rows.ok) return rows;
  if (rows.data.length >= MAX_TYPES_PER_ORG)
    return failure("conflict", "The firm holds as many request types as it can.", TYPE_LIMIT_CODE);
  const last = rows.data.reduce((max, row) => Math.max(max, row.sort_order), 0);
  const { data, error } = await db
    .from("matter_request_types")
    .insert({
      organization_id: who.data.orgId,
      name,
      sort_order: last + 10,
      created_by: actor.userId,
    })
    .select(TYPE_COLUMNS)
    .single();
  if (pgCode(error) === UNIQUE_VIOLATION)
    return failure("conflict", "A request type has that name.", TYPE_NAME_TAKEN_CODE);
  if (error || !data) return internalFailure(error);
  const row = data as unknown as TypeRow;
  await audit(db, actor, who.data.orgId, "request_types.created", row.id);
  return ok(toType(row));
}

export async function updateRequestType(
  db: Db,
  actor: Actor & { typeId: unknown; body: unknown },
): Promise<ServiceResult<MatterRequestType>> {
  const who = await manager(db, actor);
  if (!who.ok) return who;
  if (typeof actor.typeId !== "string" || !isUuid(actor.typeId)) return failure("not_found", NOT_FOUND);
  const body = actor.body;
  if (!isRecord(body)) return failure("validation", "A request body is required.", INVALID_REQUEST_CODE);
  const changes: Record<string, unknown> = {};
  if ("name" in body) {
    const name = cleanText(body.name, TYPE_NAME_MAX);
    if (!name)
      return failure("validation", `name must be 1 to ${TYPE_NAME_MAX} characters.`, INVALID_REQUEST_CODE);
    changes.name = name;
  }
  if ("archived" in body) {
    if (typeof body.archived !== "boolean")
      return failure("validation", "archived must be true or false.", INVALID_REQUEST_CODE);
    changes.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if ("sort_order" in body) {
    if (
      typeof body.sort_order !== "number" ||
      !Number.isSafeInteger(body.sort_order) ||
      body.sort_order < 0 ||
      body.sort_order > 100000
    )
      return failure("validation", "sort_order must be a whole number.", INVALID_REQUEST_CODE);
    changes.sort_order = body.sort_order;
  }
  if (Object.keys(changes).length === 0)
    return failure("validation", "Nothing to change.", INVALID_REQUEST_CODE);
  const { data, error } = await db
    .from("matter_request_types")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", actor.typeId)
    .eq("organization_id", who.data.orgId)
    .select(TYPE_COLUMNS)
    .maybeSingle();
  if (pgCode(error) === UNIQUE_VIOLATION)
    return failure("conflict", "A request type has that name.", TYPE_NAME_TAKEN_CODE);
  if (error) return internalFailure(error);
  if (!data) return failure("not_found", NOT_FOUND);
  const row = data as unknown as TypeRow;
  await audit(db, actor, who.data.orgId, "request_types.updated", row.id);
  return ok(toType(row));
}

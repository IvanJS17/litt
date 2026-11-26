/**
 * Playbooks linked to the firm's request types (docs/matter-requests.md,
 * "Playbooks suggested for a type"). Every member of a team organization reads
 * the links; only an owner or admin (the people who edit the catalog) changes
 * them. A playbook is linkable only when it is ready, shared with the whole firm
 * and belongs to the same firm as the type. Unlinking marks the row; the
 * history stays. Nothing here involves a model.
 */

import type {
  RequestTypePlaybook,
  RequestTypePlaybookLinks,
  RequestTypePlaybookOption,
  RequestTypePlaybookUnlinked,
} from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { getOrgRole } from "../../lib/access";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { resolvePlaybookRoles } from "../playbooks/playbooks.service";
import { isRecord, INVALID_REQUEST_CODE } from "./requests.shared";
import { manager, teamMember } from "./requests.types";

type Actor = { userId: string; userEmail?: string | null; orgId: unknown };

const NOT_FOUND = "Not found";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const MAX_OPTIONS = 500;

export const PLAYBOOK_NOT_READY_CODE = "playbook_not_ready";
export const PLAYBOOK_ALREADY_LINKED_CODE = "request_type_playbook_linked";

function pgCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

type LinkRow = { type_id: string; playbook_id: string; linked_at: string };
type PlaybookRow = { id: string; name: string };
type AccessRow = PlaybookRow & { user_id: string; org_id: string | null; visibility: string | null };

const LINK_COLUMNS = "type_id, playbook_id, linked_at";

/**
 * The playbooks of `rows` the person may open, by the playbooks module's own
 * rule: a member on a playbook's deny list does not see it.
 */
async function openableBy(db: Db, userId: string, orgId: string, rows: AccessRow[]): Promise<PlaybookRow[]> {
  const role = await getOrgRole(userId, orgId, db);
  if (!role) return [];
  const roles = await resolvePlaybookRoles(db, rows, userId, null, new Map([[orgId, role]]));
  return rows.filter((row) => roles.has(row.id)).map((row) => ({ id: row.id, name: row.name }));
}

/** The ready playbooks shared with the firm the person may open: what can be linked, by name. */
async function readyPlaybooks(db: Db, userId: string, orgId: string, ids?: string[]): Promise<ServiceResult<PlaybookRow[]>> {
  let query = db
    .from("playbooks")
    .select("id, name, user_id, org_id, visibility")
    .eq("org_id", orgId)
    .eq("visibility", "organization")
    .eq("status", "ready");
  if (ids) query = query.in("id", ids);
  const { data, error } = await query
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_OPTIONS);
  if (error) return internalFailure(error);
  try {
    return ok(await openableBy(db, userId, orgId, (data ?? []) as unknown as AccessRow[]));
  } catch (caught) {
    return internalFailure(caught);
  }
}

async function typeInOrg(db: Db, orgId: string, typeId: unknown, openOnly = false): Promise<ServiceResult<string>> {
  if (typeof typeId !== "string" || !isUuid(typeId)) return failure("not_found", NOT_FOUND);
  // An archived type cannot get a new link; it can still be read and unlinked.
  let query = db.from("matter_request_types").select("id").eq("id", typeId).eq("organization_id", orgId);
  if (openOnly) query = query.is("archived_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) return internalFailure(error);
  if (!data) return failure("not_found", NOT_FOUND);
  return ok(typeId);
}

/** Open links of the firm (of one type when given), with the playbooks still linkable. */
async function readLinks(
  db: Db,
  userId: string,
  orgId: string,
  typeId: string | null,
  admin: boolean,
): Promise<ServiceResult<RequestTypePlaybookLinks>> {
  let query = db
    .from("request_type_playbooks")
    .select(LINK_COLUMNS)
    .eq("org_id", orgId)
    .is("unlinked_at", null)
    .order("linked_at", { ascending: true })
    .order("id", { ascending: true });
  if (typeId) query = query.eq("type_id", typeId);
  const { data, error } = await query;
  if (error) return internalFailure(error);
  const playbooks = await readyPlaybooks(db, userId, orgId);
  if (!playbooks.ok) return playbooks;
  // Names come from the links' own ids, not from the capped option list: a
  // firm with more than MAX_OPTIONS ready playbooks must not lose a link.
  const linkedIds = [...new Set(((data ?? []) as unknown as LinkRow[]).map((row) => row.playbook_id))];
  const linked = linkedIds.length ? await readyPlaybooks(db, userId, orgId, linkedIds) : ok([] as PlaybookRow[]);
  if (!linked.ok) return linked;
  const names = new Map(linked.data.map((row) => [row.id, row.name]));
  // A link to a playbook that is gone, private or not ready reads as absent.
  const links: RequestTypePlaybook[] = ((data ?? []) as unknown as LinkRow[]).flatMap((row) => {
    const name = names.get(row.playbook_id);
    return name === undefined
      ? []
      : [{ type_id: row.type_id, playbook_id: row.playbook_id, name, linked_at: row.linked_at }];
  });
  const available: RequestTypePlaybookOption[] = playbooks.data.map((row) => ({ id: row.id, name: row.name }));
  return ok({ links, available, can_manage: admin });
}

export async function listTypePlaybooks(
  db: Db,
  actor: Actor & { typeId?: unknown },
): Promise<ServiceResult<RequestTypePlaybookLinks>> {
  const who = await teamMember(db, actor);
  if (!who.ok) return who;
  let typeId: string | null = null;
  if (actor.typeId !== undefined) {
    const type = await typeInOrg(db, who.data.orgId, actor.typeId);
    if (!type.ok) return type;
    typeId = type.data;
  }
  return readLinks(db, actor.userId, who.data.orgId, typeId, who.data.admin);
}

function audit(db: Db, actor: Actor, orgId: string, action: string, typeId: string, playbookId: string) {
  return recordAudit(db, {
    userId: actor.userId,
    userEmail: actor.userEmail ?? null,
    orgId,
    action,
    surface: "organization",
    detail: { org_id: orgId, request_type_id: typeId, playbook_id: playbookId },
  });
}

export async function linkTypePlaybook(
  db: Db,
  actor: Actor & { typeId: unknown; body: unknown },
): Promise<ServiceResult<RequestTypePlaybook>> {
  const who = await manager(db, actor);
  if (!who.ok) return who;
  const type = await typeInOrg(db, who.data.orgId, actor.typeId, true);
  if (!type.ok) return type;
  const playbookId = isRecord(actor.body) ? actor.body.playbook_id : undefined;
  if (typeof playbookId !== "string" || !isUuid(playbookId))
    return failure("validation", "playbook_id is required.", INVALID_REQUEST_CODE);
  // Another firm's playbook, a private one and a missing one are the same 404.
  const { data, error } = await db
    .from("playbooks")
    .select("id, name, status, user_id, org_id, visibility")
    .eq("id", playbookId)
    .eq("org_id", who.data.orgId)
    .eq("visibility", "organization")
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!data) return failure("not_found", NOT_FOUND);
  const playbook = data as unknown as AccessRow & { status: string };
  // A playbook the person may not open reads as unknown, as a private one does.
  try {
    if (!(await openableBy(db, actor.userId, who.data.orgId, [playbook])).length) return failure("not_found", NOT_FOUND);
  } catch (caught) {
    return internalFailure(caught);
  }
  if (playbook.status !== "ready")
    return failure("conflict", "Only a ready playbook can be linked.", PLAYBOOK_NOT_READY_CODE);
  const { data: row, error: insertError } = await db
    .from("request_type_playbooks")
    .insert({
      org_id: who.data.orgId,
      type_id: type.data,
      playbook_id: playbookId,
      linked_by: actor.userId,
    })
    .select(LINK_COLUMNS)
    .single();
  if (pgCode(insertError) === UNIQUE_VIOLATION)
    return failure("conflict", "That playbook is already linked to the type.", PLAYBOOK_ALREADY_LINKED_CODE);
  if (pgCode(insertError) === CHECK_VIOLATION)
    return failure("conflict", "Only a ready playbook can be linked.", PLAYBOOK_NOT_READY_CODE);
  if (insertError || !row) return internalFailure(insertError);
  const link = row as unknown as LinkRow;
  await audit(db, actor, who.data.orgId, "request_type_playbooks.linked", type.data, playbookId);
  return ok({ type_id: link.type_id, playbook_id: link.playbook_id, name: playbook.name, linked_at: link.linked_at });
}

export async function unlinkTypePlaybook(
  db: Db,
  actor: Actor & { typeId: unknown; playbookId: unknown },
): Promise<ServiceResult<RequestTypePlaybookUnlinked>> {
  const who = await manager(db, actor);
  if (!who.ok) return who;
  const type = await typeInOrg(db, who.data.orgId, actor.typeId);
  if (!type.ok) return type;
  if (typeof actor.playbookId !== "string" || !isUuid(actor.playbookId)) return failure("not_found", NOT_FOUND);
  const { data, error } = await db
    .from("request_type_playbooks")
    .update({ unlinked_at: new Date().toISOString(), unlinked_by: actor.userId })
    .eq("org_id", who.data.orgId)
    .eq("type_id", type.data)
    .eq("playbook_id", actor.playbookId)
    .is("unlinked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!data) return failure("not_found", NOT_FOUND);
  await audit(db, actor, who.data.orgId, "request_type_playbooks.unlinked", type.data, actor.playbookId);
  return ok({ type_id: type.data, playbook_id: actor.playbookId, unlinked: true });
}

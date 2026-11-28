// Storage quota: which space an upload fills and how much a space uses.
//
// A firm's space is 10 GB for each member who has accepted, shared by the whole
// firm; a person's personal space is 2 GB (both configurable, see
// storageQuotaConfiguration). Only opening a NEW upload session is refused when
// the space is full: nothing is deleted, and editing, generated documents,
// downloads and deletions keep working.
//
// `storageSpaceUsage` is the one answer to "how much does this space use and
// what is its limit". The check that opens an upload session asks the same
// database function (`storage_space_usage`), under a lock on the space, inside
// `create_upload_session`; anything that shows usage calls this function.

import { getOrgRole } from "./access";
import { teamOrgIdOf } from "./personalOrgs";
import { storageQuotaConfiguration } from "./runtimeConfig";
import type { Db } from "./supabase";

/** A firm (`orgId`) or one person's personal space (`userId`). */
export type StorageSpace =
  | { orgId: string; userId: null }
  | { orgId: null; userId: string };

type QuotaConfiguration = ReturnType<typeof storageQuotaConfiguration>;
type UsageConfiguration = Pick<QuotaConfiguration, "bytesPerMember" | "personalBytes">;

export type StorageSpaceUsage = { usedBytes: number; limitBytes: number };

/**
 * Bytes a space uses (the stored file of every document version, previous
 * versions included; a deleted version or document no longer counts, plus the bytes of upload sessions still
 * open) and its limit. Throws when the answer cannot be read, or when one of
 * its two numbers is not a whole count of bytes: an unreadable space is not an
 * empty one.
 */
export async function storageSpaceUsage(
  db: Db,
  space: StorageSpace,
  config: UsageConfiguration = storageQuotaConfiguration(),
): Promise<StorageSpaceUsage> {
  const { data, error } = await db.rpc("storage_space_usage", {
    p_org_id: space.orgId,
    p_user_id: space.userId,
    p_bytes_per_member: config.bytesPerMember,
    p_personal_bytes: config.personalBytes,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { used_bytes?: number | string; limit_bytes?: number | string }
    | null
    | undefined;
  const usedBytes = wholeBytes(row?.used_bytes);
  const limitBytes = wholeBytes(row?.limit_bytes);
  if (error || usedBytes === null || limitBytes === null)
    throw new Error("Failed to read the storage usage of a space", {
      cause: error ?? undefined,
    });
  return { usedBytes, limitBytes };
}

/** The code and sentence an upload is refused with when the space is full; a copy is refused with the same. */
export const STORAGE_QUOTA_EXCEEDED_CODE = "storage_quota_exceeded";
export const STORAGE_QUOTA_EXCEEDED_DETAIL =
  "There is no storage space left here, so this can't be uploaded or saved. Everything you have stays available. Delete documents or earlier versions you no longer need, or ask your firm's administrator for more space.";

/** A copy that does not fit in the space it would fill. */
export class StorageQuotaExceededError extends Error {
  constructor() {
    super(STORAGE_QUOTA_EXCEEDED_CODE);
    this.name = "StorageQuotaExceededError";
  }
}

/**
 * Whether `bytes` more fit in a space: the comparison `create_upload_session`
 * makes, written once more here because the database function cannot be
 * called for a copy. Exactly at the limit fits; one byte over does not. A
 * new version of an existing document may go over by `versionMarginPercent`
 * of the limit (rounded down). Keep this in step with that function.
 */
export function fitsInSpace(
  { usedBytes, limitBytes }: StorageSpaceUsage,
  bytes: number,
  newVersionMarginPercent: number | null,
): boolean {
  const limit = BigInt(limitBytes);
  const allowed =
    newVersionMarginPercent === null
      ? limit
      : limit + (limit * BigInt(newVersionMarginPercent)) / 100n;
  return BigInt(usedBytes) + BigInt(bytes) <= allowed;
}

/** How full a space is, said without a figure. */
export type StorageLevel = "ok" | "almostFull";

/**
 * The one rule for "almost full": the space uses at least four fifths of its
 * limit (a limit of zero always does). Whole-number arithmetic, exact for any
 * count a JavaScript number holds.
 */
export function storageLevel({ usedBytes, limitBytes }: StorageSpaceUsage): StorageLevel {
  return BigInt(usedBytes) * 5n >= BigInt(limitBytes) * 4n ? "almostFull" : "ok";
}

/** What a person is told about the space an upload fills: its level and which space it is, never a figure. */
export type StorageNotice = {
  storageLevel: StorageLevel;
  storageSpace: { kind: "personal" | "firm"; id: string };
};

/**
 * What the person opening an upload is told about the space it fills, from one
 * read of its use. Only a person whose space it is is told: their own personal
 * space, or a firm they belong to. Anyone else (someone adding a version to
 * another person's document, someone working in a firm they are not a member
 * of) is told nothing, and the use is not read. A failed read of the use says
 * "ok", and a failed read of the membership says nothing: opening the upload
 * is never held back by a notice about the space.
 */
export async function storageNoticeOfSpace(
  db: Db,
  space: StorageSpace,
  userId: string,
): Promise<StorageNotice | null> {
  let storageSpace: StorageNotice["storageSpace"];
  if (space.orgId === null) {
    if (space.userId !== userId) return null;
    storageSpace = { kind: "personal", id: userId };
  } else {
    try {
      if (!(await getOrgRole(userId, space.orgId, db))) return null;
    } catch {
      return null;
    }
    storageSpace = { kind: "firm", id: space.orgId };
  }
  try {
    return { storageLevel: storageLevel(await storageSpaceUsage(db, space)), storageSpace };
  } catch {
    return { storageLevel: "ok", storageSpace };
  }
}

/**
 * A count of bytes as the database answers it: a whole number from 0 up that
 * a JavaScript number holds exactly, as a number or in plain digits. Anything
 * else is not an answer.
 */
function wholeBytes(value: unknown): number | null {
  const count = typeof value === "string" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
  if (typeof value === "string" && String(count) !== value) return null;
  return count;
}

/** The arguments `create_upload_session` takes to check and reserve a space. */
export function quotaRpcArgs(space: StorageSpace, config: QuotaConfiguration) {
  return {
    target_quota_org_id: space.orgId,
    target_quota_user_id: space.userId,
    target_quota_bytes_per_member: config.bytesPerMember,
    target_quota_personal_bytes: config.personalBytes,
    // Only a session that adds a version to an existing document uses it
    // (create_upload_session decides by the session's purpose).
    target_quota_version_margin_percent: config.versionMarginPercent,
  };
}

type Resolved =
  | { ok: true; space: StorageSpace }
  | { ok: false; detail: string };

const personal = (userId: string): Resolved => ({
  ok: true,
  space: { orgId: null, userId },
});
const firm = (orgId: string): Resolved => ({
  ok: true,
  space: { orgId, userId: null },
});

/**
 * A row filed under an organization is a firm's, unless the organization is a
 * person's own personal one (`teamOrgIdOf`, the rule the access code uses):
 * that is the person's personal space. No current path files documents,
 * projects or workflows under a personal organization; this keeps the quota
 * right if one ever does.
 */
async function spaceOfOrg(
  db: Db,
  orgId: string,
  fallbackUserId: string,
): Promise<Resolved> {
  if (await teamOrgIdOf(db, orgId)) return firm(orgId);
  const { data, error } = await db
    .from("organizations")
    .select("personal_user_id")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error("Failed to read the personal organization");
  const owner = (data as { personal_user_id?: string | null } | null)?.personal_user_id;
  return personal(owner ?? fallbackUserId);
}

async function readRow(
  db: Db,
  table: "projects" | "workflows" | "documents",
  id: unknown,
  columns: string,
): Promise<{ row: Record<string, unknown> | null; failed: boolean }> {
  if (typeof id !== "string") return { row: null, failed: false };
  const { data, error } = await db
    .from(table)
    .select(columns)
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, failed: true };
  return { row: (data as Record<string, unknown> | null) ?? null, failed: false };
}

/**
 * The space a new upload session fills, by the repository's rule for whose
 * content something is: a firm's project or workflow, or the organization a
 * standalone/library upload names, files its documents under that firm;
 * anything else is the uploader's personal space. A new version is counted in
 * the space of the document it is added to (a personal document: its owner).
 * The destination was authorized before this is asked.
 */
export async function resolveUploadSpace(
  db: Db,
  args: { purpose: string; destination: Record<string, unknown>; userId: string },
): Promise<Resolved> {
  try {
    return await resolveSpace(db, args);
  } catch {
    // A failed read is never answered with a guess.
    return { ok: false, detail: "Failed to resolve the storage space of the upload" };
  }
}

async function resolveSpace(
  db: Db,
  args: { purpose: string; destination: Record<string, unknown>; userId: string },
): Promise<Resolved> {
  const { purpose, destination, userId } = args;
  const unreadable: Resolved = {
    ok: false,
    detail: "Failed to resolve the storage space of the upload",
  };

  if (purpose === "document_version_create" || purpose === "document_version_replace") {
    const { row, failed } = await readRow(db, "documents", destination.document_id, "org_id, user_id");
    if (failed || !row) return unreadable;
    const owner = typeof row.user_id === "string" ? row.user_id : userId;
    if (typeof row.org_id === "string") return spaceOfOrg(db, row.org_id, owner);
    return personal(owner);
  }

  let table: "projects" | "workflows" | null = null;
  let id: unknown;
  if (purpose === "document_create") {
    if (destination.scope === "project") [table, id] = ["projects", destination.project_id];
    else if (destination.scope === "workflow") [table, id] = ["workflows", destination.workflow_id];
    else
      return typeof destination.org_id === "string" && destination.org_id
        ? spaceOfOrg(db, destination.org_id, userId)
        : personal(userId);
  } else {
    // The two workflow-reference purposes kept for sessions of the previous release.
    [table, id] = ["workflows", destination.workflow_id];
  }
  const { row, failed } = await readRow(db, table, id, "org_id");
  if (failed || !row) return unreadable;
  return typeof row.org_id === "string"
    ? spaceOfOrg(db, row.org_id, userId)
    : personal(userId);
}

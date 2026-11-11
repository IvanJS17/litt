import { processDocumentTextInline } from "./documents.indexing";
import { safeError } from "../../lib/safeError";
import { logError } from "../../lib/log";
import {
  captureInlineVersionUpdateCleanup,
  completeInlineDocumentCleanup,
} from "./documents.cleanupJobs";
import { type Db } from "../../lib/supabase";
import { resolveTrainingStage } from "../../lib/training";
import { AppError } from "../../lib/appError";

/**
 * Whose content a new version holds, which decides its pasante seal
 * (docs/training.md). Every insertion names one:
 * - `author`: content the actor wrote or produced (upload, edit, generated
 *   file). Sealed with the actor as author when the actor's effective stage
 *   in the document's organization and project is `pasante`.
 * - `copy`: bytes copied from another version, identified by its id or, when
 *   only the object is known, its storage path. The copy keeps the source's
 *   seal and author, whoever copies it.
 * - `catalog`: material imported from the catalog, never a pasante's.
 */
export type VersionAuthorship =
  | { kind: "author"; userId: string }
  | { kind: "copy"; sourceVersionId: string }
  | { kind: "copy"; sourceStoragePath: string }
  | { kind: "catalog" };

/** What document_versions stores: both set, or both null. */
export type TrainingSeal = {
  training_author_user_id: string | null;
  training_stage: "pasante" | null;
};

const NO_SEAL: TrainingSeal = { training_author_user_id: null, training_stage: null };

export type NewDocumentVersion = {
  authorship: VersionAuthorship;
  id?: string;
  document_id: string;
  storage_path: string;
  pdf_storage_path?: string | null;
  source: string;
  version_number?: number | null;
  filename: string;
  file_type?: string | null;
  size_bytes?: number | null;
  page_count?: number | null;
  textless_page_count?: number | null;
  content_sha256?: string | null;
  /** A user edit: the version it was made on. The RPC refuses it if it is no longer current. */
  base_version_id?: string | null;
};

export type DocumentVersionRecord = Omit<NewDocumentVersion, "authorship"> &
  TrainingSeal & {
  id: string;
  version_number: number;
  created_at: string;
  deleted_at: string | null;
};

/**
 * Trusted persistence operation. The caller must authorize the destination
 * (and independently authorize any copy source). Upload workers use their
 * validated session destination; chat tools use their authorized document
 * store. Number allocation, insertion and activation share one transaction.
 * A stable id makes retries idempotent without overwriting newer work.
 */
export async function createDocumentVersion(
  db: Db,
  version: NewDocumentVersion,
  options: { activate?: boolean } = {},
) {
  let row: Record<string, unknown> & { document_id: string };
  try {
    row = await sealedVersionRow(db, version);
  } catch (error) {
    return { data: null, error: sealFailure(error) };
  }
  const { document_id, ...metadata } = row;
  const { data, error } = await db.rpc("create_document_version", {
    p_document_id: document_id,
    p_version: metadata,
    p_activate: options.activate !== false,
  });
  if (!error && data?.id) await processDocumentTextInline(db, [data.id]).catch((err) => logError("document-text", safeError(err)));
  return { data: data as DocumentVersionRecord | null, error };
}

/** All versions and active pointers commit together, or none do. */
export async function createDocumentVersions(
  db: Db,
  versions: NewDocumentVersion[],
) {
  let rows: Record<string, unknown>[];
  try {
    rows = await Promise.all(versions.map((version) => sealedVersionRow(db, version)));
  } catch (error) {
    return { data: null, error: sealFailure(error) };
  }
  const { data, error } = await db.rpc("create_document_versions", {
    p_versions: rows,
  });
  if (!error && data?.length) await processDocumentTextInline(db, data.map((row: DocumentVersionRecord) => row.id)).catch((err) => logError("document-text", safeError(err)));
  return { data: data as DocumentVersionRecord[] | null, error };
}

/** Call after dependent edit rows are persisted. Reject stale/deleted targets. */
export async function activateDocumentVersion(
  db: Db,
  documentId: string,
  versionId: string,
) {
  const { data, error } = await db.rpc("activate_document_version", {
    p_document_id: documentId,
    p_version_id: versionId,
  });
  return { activated: data === true, error };
}

export type DocumentVersionPatch = Partial<
  Omit<NewDocumentVersion, "id" | "document_id" | "source" | "version_number">
> & {
  content_sha256?: string | null;
  created_at?: string;
};

/**
 * Only live versions within the authorized document can be replaced.
 * `actorUserId` is who changes the bytes: a pasante seals the version as its
 * author. An existing seal is kept as it is (the database restores it), so a
 * lawyer's change never unseals a pasante's version.
 */
export async function updateDocumentVersion(
  db: Db,
  documentId: string,
  versionId: string,
  patch: DocumentVersionPatch,
  options: {
    actorUserId: string;
    expectedStoragePath?: string;
    expectedContentSha256?: string | null;
  },
) {
  let seal: TrainingSeal;
  try {
    seal = await authorSeal(db, documentId, options.actorUserId);
  } catch (error) {
    return { data: null, error: sealFailure(error) };
  }
  const keys = await captureInlineVersionUpdateCleanup(
    db,
    documentId,
    versionId,
    patch,
  );
  let query = db
    .from("document_versions")
    .update(seal.training_stage ? { ...patch, ...seal } : patch)
    .eq("id", versionId)
    .eq("document_id", documentId)
    .is("deleted_at", null);
  if (options.expectedStoragePath !== undefined)
    query = query.eq("storage_path", options.expectedStoragePath);
  if (options.expectedContentSha256 !== undefined)
    query = options.expectedContentSha256 === null
      ? query.is("content_sha256", null)
      : query.eq("content_sha256", options.expectedContentSha256);
  const result = await query
    .select(
      "id, version_number, source, created_at, filename, file_type, size_bytes, page_count, textless_page_count",
    )
    .maybeSingle();
  if (!result.error && result.data)
    await completeInlineDocumentCleanup(db, keys);
  if (!result.error && result.data && ("storage_path" in patch || "content_sha256" in patch || "file_type" in patch)) await processDocumentTextInline(db, [versionId]).catch((err) => logError("document-text", safeError(err)));
  return result;
}

/** The RPC row for a new version: its metadata plus the seal it carries. */
async function sealedVersionRow(
  db: Db,
  version: NewDocumentVersion,
): Promise<Record<string, unknown> & { document_id: string }> {
  const { authorship, ...metadata } = version;
  const seal = await resolveSeal(db, version.document_id, authorship);
  return seal.training_stage ? { ...metadata, ...seal } : metadata;
}

/**
 * The seal a new version gets. A read failure throws: writing the version
 * without its seal would release a pasante's work unapproved.
 */
async function resolveSeal(
  db: Db,
  documentId: string,
  authorship: VersionAuthorship,
): Promise<TrainingSeal> {
  if (authorship.kind === "catalog") return NO_SEAL;
  if (authorship.kind === "author")
    return authorSeal(db, documentId, authorship.userId);
  let query = db
    .from("document_versions")
    .select("training_author_user_id, training_stage");
  query =
    "sourceVersionId" in authorship
      ? query.eq("id", authorship.sourceVersionId)
      : query.eq("storage_path", authorship.sourceStoragePath);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as TrainingSeal[];
  // A source that vanished cannot vouch for being unsealed: refuse the copy.
  if (rows.length === 0)
    throw new AppError("training.copy_source_missing", "The copied version's source was not found");
  // Several rows can share an object; any seal among them is kept.
  const sealed = rows.find(
    (row) => row.training_stage === "pasante" && row.training_author_user_id,
  );
  if (!sealed) return NO_SEAL;
  // Approval is decided inside an organization (documents.trainingApproval):
  // a sealed copy outside one could never be released, so it is not made.
  const { data: target, error: targetError } = await db
    .from("documents")
    .select("org_id")
    .eq("id", documentId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!(target as { org_id: string | null } | null)?.org_id)
    throw new AppError(
      "training.copy_without_org",
      "A pasante's version cannot be copied outside an organization",
    );
  return { training_author_user_id: sealed.training_author_user_id, training_stage: "pasante" };
}

/** Sealed with `userId` as author when they are a pasante where the document lives. */
async function authorSeal(
  db: Db,
  documentId: string,
  userId: string,
): Promise<TrainingSeal> {
  const { data, error } = await db
    .from("documents")
    .select("org_id, project_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  const doc = data as { org_id: string | null; project_id: string | null } | null;
  if (!doc?.org_id) return NO_SEAL;
  const stage = await resolveTrainingStage(db, userId, {
    orgId: doc.org_id,
    projectId: doc.project_id,
  });
  return stage === "pasante"
    ? { training_author_user_id: userId, training_stage: "pasante" }
    : NO_SEAL;
}

function sealFailure(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new AppError("db.query_failed", "Failed to read the training seal", { cause });
}

// LiTT training (docs/training.md): may a document version leave LiTT?
//
// A version a pasante wrote carries a seal (document_versions.training_stage
// = 'pasante'). It is releasable when it has no seal, or when an approval
// exists for its CURRENT content_sha256: an approval binds bytes, so changing
// them in place (accepting an edit, replacing the file) needs a new one.
// Every blocked output asks this file; `heldVersionIds` is the one rule.

import {
  TRAINING_APPROVAL_REQUIRED_CODE,
  TRAINING_APPROVAL_REQUIRED_MESSAGE,
} from "./httpError";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "./serviceResult";
import type { Db } from "./supabase";

/** The columns of a document_versions row the release rule reads. */
export type ReleaseCandidate = {
  id: string;
  training_stage?: string | null;
  content_sha256?: string | null;
};

export type TrainingApprovalRequired = {
  ok: false;
  kind: "conflict";
  detail: string;
  code: typeof TRAINING_APPROVAL_REQUIRED_CODE;
};

/** The 409 every blocked output answers. */
export function trainingApprovalRequired(): TrainingApprovalRequired {
  return {
    ok: false,
    kind: "conflict",
    detail: TRAINING_APPROVAL_REQUIRED_MESSAGE,
    code: TRAINING_APPROVAL_REQUIRED_CODE,
  };
}

/**
 * The ids, among already-loaded `versions`, that may not leave: sealed and
 * without an approval for their current bytes. Unsealed rows cost no query.
 * A read failure is an internal failure, never a release.
 */
export async function heldVersionIds(
  db: Db,
  versions: readonly ReleaseCandidate[],
): Promise<ServiceResult<Set<string>>> {
  const sealed = versions.filter((version) => version.training_stage != null);
  const held = new Set(sealed.map((version) => version.id));
  const hashed = sealed.filter((version) => !!version.content_sha256);
  if (hashed.length === 0) return ok(held);
  const { data, error } = await db
    .from("training_version_approvals")
    .select("document_version_id, content_sha256")
    .in("document_version_id", [...new Set(hashed.map((version) => version.id))]);
  if (error) return internalFailure(error);
  const approved = new Set(
    ((data ?? []) as { document_version_id: string; content_sha256: string }[]).map(
      (approval) => `${approval.document_version_id}:${approval.content_sha256}`,
    ),
  );
  for (const version of hashed) {
    if (approved.has(`${version.id}:${version.content_sha256}`))
      held.delete(version.id);
  }
  return ok(held);
}

/**
 * `heldVersionIds` for display: when the approvals cannot be read, every
 * sealed row counts as held, so the UI never offers what the server refuses.
 */
export async function heldVersionIdsOrSealed(
  db: Db,
  versions: readonly ReleaseCandidate[],
): Promise<Set<string>> {
  const held = await heldVersionIds(db, versions);
  if (held.ok) return held.data;
  return new Set(
    versions.filter((version) => version.training_stage != null).map((version) => version.id),
  );
}

/** Whether one version is held; any doubt (a failed read, no live row) holds it. */
export async function isVersionHeld(db: Db, versionId: string): Promise<boolean> {
  try {
    return !(await assertReleasable(db, versionId)).ok;
  } catch {
    return true;
  }
}

/** `ok` when this already-loaded version may leave, else the 409. */
export async function assertVersionReleasable(
  db: Db,
  version: ReleaseCandidate,
): Promise<ServiceResult<void>> {
  const held = await heldVersionIds(db, [version]);
  if (!held.ok) return held;
  return held.data.size === 0 ? ok(undefined) : trainingApprovalRequired();
}

/**
 * `ok` when the version may be released; a 409 `training_approval_required`
 * conflict when it is sealed and its current bytes are not approved; a
 * not_found when there is no live version with that id. A read failure is an
 * internal failure, never a release.
 */
export async function assertReleasable(
  db: Db,
  versionId: string,
): Promise<ServiceResult<void>> {
  const { data: version, error } = await db
    .from("document_versions")
    .select("training_stage, content_sha256")
    .eq("id", versionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!version) return failure("not_found", "Version not found");
  const row = version as { training_stage: string | null; content_sha256: string | null };
  return assertVersionReleasable(db, { id: versionId, ...row });
}

// LiTT training (docs/training.md): may a document version leave LiTT?
//
// A version a pasante wrote carries a seal (document_versions.training_stage
// = 'pasante'). It is releasable when it has no seal, or when an approval
// exists for its CURRENT content_sha256: an approval binds bytes, so changing
// them in place (accepting an edit, replacing the file) needs a new one.
// Every blocked output asks this one helper.

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
  if (row.training_stage === null) return ok(undefined);
  if (row.content_sha256) {
    const { data: approval, error: approvalError } = await db
      .from("training_version_approvals")
      .select("id")
      .eq("document_version_id", versionId)
      .eq("content_sha256", row.content_sha256)
      .maybeSingle();
    if (approvalError) return internalFailure(approvalError);
    if (approval) return ok(undefined);
  }
  return failure(
    "conflict",
    TRAINING_APPROVAL_REQUIRED_MESSAGE,
    TRAINING_APPROVAL_REQUIRED_CODE,
  );
}

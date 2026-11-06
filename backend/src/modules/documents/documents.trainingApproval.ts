// LiTT training (docs/training.md): approving a pasante's version.
//
// The approval binds the version's CURRENT bytes (content_sha256); new bytes
// in place need a new approval (lib/trainingRelease.ts). Who approves: a
// member with content.edit in the document's project whose effective stage
// there is none (a lawyer), or the author's current mentor; never the author,
// never a pasante or a junior. Somebody who can read the document but may not
// approve gets one 403 whatever the reason; somebody who cannot read it, 404.

import type { TrainingVersionApproval } from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { can } from "../../lib/permissions";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { resolveTrainingStage } from "../../lib/training";
import { ensureDocumentAccess } from "./documents.access";

const NOT_FOUND = failure("not_found", "Version not found");
const FORBIDDEN = failure("forbidden", "No puedes aprobar esta versión.");

type SealedVersion = {
  id: string;
  training_author_user_id: string | null;
  training_stage: string | null;
  content_sha256: string | null;
};

export async function approveTrainingVersion(
  db: Db,
  input: {
    documentId: string;
    versionId: string;
    userId: string;
    userEmail?: string | null;
  },
): Promise<ServiceResult<TrainingVersionApproval>> {
  try {
    const access = await ensureDocumentAccess(
      input.documentId,
      input.userId,
      input.userEmail ?? undefined,
      db,
    );
    if (!access.ok) {
      if (access.kind === "error") return internalFailure(access.error);
      return NOT_FOUND;
    }
    const doc = access.doc as { org_id?: string | null; project_id?: string | null };
    const { data, error } = await db
      .from("document_versions")
      .select("id, training_author_user_id, training_stage, content_sha256")
      .eq("id", input.versionId)
      .eq("document_id", input.documentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return internalFailure(error);
    const version = data as SealedVersion | null;
    if (!version) return NOT_FOUND;
    if (version.training_stage === null || !version.training_author_user_id)
      return failure("conflict", "Esta versión no necesita aprobación.");
    if (!version.content_sha256)
      return failure("conflict", "Esta versión no tiene huella de contenido y no se puede aprobar.");

    const author = version.training_author_user_id;
    const orgId = doc.org_id ?? null;
    if (input.userId === author || !orgId) return FORBIDDEN;
    const stage = await resolveTrainingStage(db, input.userId, {
      orgId,
      projectId: doc.project_id ?? null,
    });
    if (stage !== null) return FORBIDDEN;
    const lawyer = !!doc.project_id && can(access.projectRole, "content.edit");
    if (!lawyer && !(await isCurrentMentor(db, orgId, author, input.userId)))
      return FORBIDDEN;

    const approval = await insertApproval(db, {
      document_version_id: version.id,
      content_sha256: version.content_sha256,
      org_id: orgId,
      approved_by: input.userId,
    });
    if (approval.created)
      await recordAudit(db, {
        userId: input.userId,
        userEmail: input.userEmail ?? null,
        orgId,
        action: "training.version_approved",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: author },
      });
    return ok({
      document_version_id: version.id,
      content_sha256: version.content_sha256,
      approved_at: approval.created_at,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

async function isCurrentMentor(
  db: Db,
  orgId: string,
  traineeId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("training_pupils")
    .select("mentor_user_id")
    .eq("org_id", orgId)
    .eq("trainee_user_id", traineeId)
    .eq("mentor_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Insert-only and idempotent: approving the same bytes twice keeps the first. */
async function insertApproval(
  db: Db,
  row: {
    document_version_id: string;
    content_sha256: string;
    org_id: string;
    approved_by: string;
  },
): Promise<{ created: boolean; created_at: string }> {
  const { data, error } = await db
    .from("training_version_approvals")
    .insert(row)
    .select("created_at")
    .single();
  if (!error && data)
    return { created: true, created_at: (data as { created_at: string }).created_at };
  if (error?.code !== "23505") throw error ?? new Error("approval insert returned no row");
  const { data: existing, error: readError } = await db
    .from("training_version_approvals")
    .select("created_at")
    .eq("document_version_id", row.document_version_id)
    .eq("content_sha256", row.content_sha256)
    .single();
  if (readError || !existing) throw readError ?? new Error("approval not found after conflict");
  return { created: false, created_at: (existing as { created_at: string }).created_at };
}

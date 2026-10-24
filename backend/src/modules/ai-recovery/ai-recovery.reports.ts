/**
 * The approved review report: render, store and serve the approved DOCX.
 *
 * The artifact is authored only from an approved review of the caller's own
 * matter; every write revalidates the review, the execution evidence, the
 * source version and the granted scope, and a stored export is read back by
 * idempotency key so a retry returns the bytes already committed instead of
 * rendering a second copy.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import type { AuthorizationScope } from "../../lib/recovery/authorization/evaluateAccess";
import {
  evaluateInitialAccess,
  recheckFreshAccessViaPort,
} from "../../lib/recovery/authorization/tenancyReadPort";
import { createSupabaseTenancyReadPort } from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import {
  createBoundEvidenceResourceScopePort,
  createSupabaseAiReadRepository,
} from "../../lib/recovery/persistence/supabaseAiReadRepository";
import {
  createApprovedArtifactPersistence,
  type ApprovedArtifactPersistenceClient,
  type ApprovedArtifactReadExpectation,
} from "../../lib/recovery/persistence/approvedArtifactPersistence";
import { approvedDocxRenderer } from "../../lib/recovery/review/approvedDocxRenderer";
import { produceApprovedReviewReport } from "../../lib/recovery/review/approvedReviewReport";
import {
  recheckHumanReviewResourceScope,
  type HumanReview,
  type HumanReviewExecution,
} from "../../lib/recovery/review/humanReview";
import { createApprovedArtifactStorage } from "./ai-recovery.storage";
import {
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import {
  isApprovedArtifactExportRow,
  isPostgresUuid,
  isRecord,
} from "./ai-recovery.validation";

export const APPROVED_REPORT_FILENAME = "Informe de revision humana.docx";
export const APPROVED_REPORT_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const NOT_FOUND = {
  ok: false,
  kind: "not_found",
  code: "not_found",
  detail: "Not found.",
} as const;
const INVALID_REPORT = {
  ok: false,
  kind: "conflict",
  code: "invalid_approved_report",
  detail: "Invalid approved report.",
} as const;
const AUTHORIZATION_REVOKED = {
  ok: false,
  kind: "forbidden",
  code: "authorization_revoked",
  detail: "Authorization revoked.",
} as const;

const storage = createApprovedArtifactStorage;

function reportExpectation(
  review: HumanReview,
  execution: HumanReviewExecution,
  idempotencyKey?: string,
): ApprovedArtifactReadExpectation {
  return {
    ...(idempotencyKey === undefined
      ? {}
      : { idempotency_key: idempotencyKey }),
    review_id: review.review_id,
    review_revision: review.revision,
    execution_id: execution.execution_id,
    organization_id: review.organization_id,
    matter_id: review.matter_id,
    project_id: review.project_id,
    source_document_id: review.document_id,
    source_document_version_id: review.document_version_id,
    source_document_sha256: review.document_content_sha256,
    evidence_receipt_sha256: review.evidence_receipt_sha256,
    filename: APPROVED_REPORT_FILENAME,
    mime_type: APPROVED_REPORT_MIME,
  };
}

function sameReportAuthority(
  expected: {
    review_id: string;
    revision: number;
    status: string;
    execution_id: string;
    organization_id: string;
    matter_id: string;
    project_id: string;
    document_id: string;
    document_version_id: string;
    document_content_sha256: string;
    evidence_receipt_sha256: string;
  },
  current: typeof expected,
): boolean {
  return (
    current.review_id === expected.review_id &&
    current.revision === expected.revision &&
    current.status === "approved" &&
    expected.status === "approved" &&
    current.execution_id === expected.execution_id &&
    current.organization_id === expected.organization_id &&
    current.matter_id === expected.matter_id &&
    current.project_id === expected.project_id &&
    current.document_id === expected.document_id &&
    current.document_version_id === expected.document_version_id &&
    current.document_content_sha256 === expected.document_content_sha256 &&
    current.evidence_receipt_sha256 === expected.evidence_receipt_sha256
  );
}

/** Render, store and record the approved report of one execution. */
export async function produceReport(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    idempotency_key: string;
    expected_review_revision: number;
  },
): Promise<
  ServiceResult<{
    export_id: string;
    artifact: unknown;
    receipt: { disposition: string };
  }>
> {
  try {
    const repository = createSupabaseAiReadRepository(db);
    const evidence = await repository.loadExecutionEvidence({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!evidence) return NOT_FOUND;
    const tenancyPort = createSupabaseTenancyReadPort(db);
    const access = await evaluateInitialAccess(tenancyPort, {
      identity: input.identity,
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      requiresMfa: true,
    });
    if (access.kind === "authorization_dependency_failed")
      throw new Error("AI approved report authorization failed");
    if (access.decision.outcome === "not_found") return NOT_FOUND;
    if (access.decision.outcome === "denied")
      return access.decision.code === "mfa_required"
        ? {
            ok: false,
            kind: "forbidden",
            code: "mfa_required",
            detail: "MFA required.",
          }
        : AUTHORIZATION_REVOKED;
    const grantedScope: AuthorizationScope = access.decision.scope;

    const review = await repository.loadReview({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!review) return NOT_FOUND;
    if (
      review.status !== "approved" ||
      review.revision !== input.expected_review_revision
    )
      return INVALID_REPORT;

    const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      project_id: input.project_id,
    });
    const revalidateCurrent = async () => {
      const currentEvidence = await repository.loadExecutionEvidence({
        project_id: input.project_id,
        execution_id: input.execution_id,
      });
      const currentReview = await repository.loadReview({
        project_id: input.project_id,
        execution_id: input.execution_id,
      });
      if (
        !currentEvidence ||
        !currentReview ||
        !sameReportAuthority(review, currentReview) ||
        currentEvidence.execution.execution_id !==
          evidence.execution.execution_id ||
        currentEvidence.execution.organization_id !==
          evidence.execution.organization_id ||
        currentEvidence.execution.matter_id !== evidence.execution.matter_id ||
        currentEvidence.execution.project_id !==
          evidence.execution.project_id ||
        currentEvidence.execution.document_id !==
          evidence.execution.document_id ||
        currentEvidence.execution.document_version_id !==
          evidence.execution.document_version_id ||
        currentEvidence.execution.document_content_sha256 !==
          evidence.execution.document_content_sha256 ||
        currentEvidence.execution.evidence_receipt_sha256 !==
          evidence.execution.evidence_receipt_sha256
      )
        return false;
      if (
        (await recheckHumanReviewResourceScope(
          resourceScopePort,
          currentReview,
        )) !== "match"
      )
        return false;
      const fresh = await recheckFreshAccessViaPort(tenancyPort, {
        scope: grantedScope,
        identity: input.identity,
        requiresMfa: true,
      });
      if (
        fresh.kind === "authorization_dependency_failed" ||
        !fresh.result.fresh
      )
        return false;
      return true;
    };

    const persistence = createApprovedArtifactPersistence({
      client: db as unknown as ApprovedArtifactPersistenceClient,
      context: {
        actor_user_id: input.identity.user_id,
        organization_id: grantedScope.organization_id,
        authorization_epoch: grantedScope.authorization_epoch,
      },
      storage: storage(),
      revalidateBeforeUpload: revalidateCurrent,
    });
    const expected = reportExpectation(
      review,
      evidence.execution,
      input.idempotency_key,
    );
    const replayAwareRenderer = {
      render: async (
        plan: Parameters<typeof approvedDocxRenderer.render>[0],
      ) => {
        if (!(await revalidateCurrent()))
          throw new Error("report superseded");
        const existing = await persistence.read({
          idempotency_key: input.idempotency_key,
          expected,
        });
        return existing ?? approvedDocxRenderer.render(plan);
      },
    };
    const result = await produceApprovedReviewReport({
      identity: input.identity,
      granted_scope: grantedScope,
      tenancy_port: tenancyPort,
      resource_scope_port: resourceScopePort,
      requires_mfa: true,
      idempotency_key: input.idempotency_key,
      expected_review_revision: input.expected_review_revision,
      review,
      execution: evidence.execution,
      evidence_receipt: evidence.evidence_receipt,
      renderer: replayAwareRenderer,
      append_port: persistence,
    });
    if (!result.ok) {
      if (result.error_class === "invalid_approved_report")
        return INVALID_REPORT;
      if (result.error_class === "approved_report_authorization_failed")
        return AUTHORIZATION_REVOKED;
      throw new Error("AI approved report operation failed");
    }

    const committedResult = await db
      .from("ai_review_exports")
      .select(
        "id,idempotency_key,review_id,review_revision,execution_id,organization_id,matter_id,project_id,source_document_id,source_document_version_id,source_document_sha256,evidence_receipt_sha256,artifact_document_id,artifact_document_version_id,artifact_sha256,storage_path,size_bytes,filename,mime_type",
      )
      .eq("idempotency_key", input.idempotency_key)
      .eq("project_id", input.project_id)
      .eq("execution_id", input.execution_id)
      .maybeSingle();
    if (committedResult.error)
      throw new Error("approved report receipt read failed");
    const rawCommitted = committedResult.data;
    const committed = isRecord(rawCommitted) ? { ...rawCommitted } : null;
    if (
      !committed ||
      !isPostgresUuid(committed.id) ||
      !isApprovedArtifactExportRow(committed, {
        export_id: committed.id,
        project_id: input.project_id,
        execution_id: input.execution_id,
        review_revision: review.revision,
        execution: evidence.execution,
      }) ||
      committed.idempotency_key !== input.idempotency_key ||
      committed.review_id !== review.review_id ||
      committed.artifact_sha256 !== result.artifact.artifact_sha256 ||
      committed.source_document_sha256 !== expected.source_document_sha256 ||
      committed.evidence_receipt_sha256 !== expected.evidence_receipt_sha256 ||
      committed.filename !== result.artifact.filename ||
      committed.mime_type !== result.artifact.mime_type
    )
      throw new Error("approved report receipt mismatch");
    if (!(await revalidateCurrent())) return AUTHORIZATION_REVOKED;
    return ok({
      export_id: committed.id,
      artifact: result.artifact,
      receipt: result.receipt,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

/** Serve the stored approved report bytes of one execution. */
export async function readReport(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    revision?: number;
  },
): Promise<
  ServiceResult<{ bytes: Uint8Array; filename: string; mime_type: string }>
> {
  try {
    const repository = createSupabaseAiReadRepository(db);
    const evidence = await repository.loadExecutionEvidence({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!evidence) return NOT_FOUND;
    const tenancyPort = createSupabaseTenancyReadPort(db);
    const access = await evaluateInitialAccess(tenancyPort, {
      identity: input.identity,
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      requiresMfa: true,
    });
    if (access.kind === "authorization_dependency_failed")
      throw new Error("AI approved report authorization failed");
    if (access.decision.outcome !== "allow") return NOT_FOUND;
    const grantedScope = access.decision.scope;

    const review = await repository.loadReview({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (
      !review ||
      review.status !== "approved" ||
      (input.revision !== undefined && review.revision !== input.revision)
    )
      return NOT_FOUND;

    const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      project_id: input.project_id,
    });
    const revalidateCurrent = async () => {
      const fresh = await recheckFreshAccessViaPort(tenancyPort, {
        scope: grantedScope,
        identity: input.identity,
        requiresMfa: true,
      });
      if (
        fresh.kind === "authorization_dependency_failed" ||
        !fresh.result.fresh
      )
        return false;
      const currentEvidence = await repository.loadExecutionEvidence({
        project_id: input.project_id,
        execution_id: input.execution_id,
      });
      const currentReview = await repository.loadReview({
        project_id: input.project_id,
        execution_id: input.execution_id,
      });
      return (
        !!currentEvidence &&
        !!currentReview &&
        sameReportAuthority(review, currentReview) &&
        currentEvidence.execution.execution_id ===
          evidence.execution.execution_id &&
        currentEvidence.execution.document_content_sha256 ===
          evidence.execution.document_content_sha256 &&
        currentEvidence.execution.evidence_receipt_sha256 ===
          evidence.execution.evidence_receipt_sha256 &&
        (await recheckHumanReviewResourceScope(
          resourceScopePort,
          currentReview,
        )) === "match"
      );
    };

    const persistence = createApprovedArtifactPersistence({
      client: db as unknown as ApprovedArtifactPersistenceClient,
      context: {
        actor_user_id: input.identity.user_id,
        organization_id: grantedScope.organization_id,
        authorization_epoch: grantedScope.authorization_epoch,
      },
      storage: storage(),
      revalidateBeforeUpload: revalidateCurrent,
    });
    const bytes = await persistence.read({
      project_id: input.project_id,
      execution_id: input.execution_id,
      ...(input.revision === undefined ? {} : { review_revision: input.revision }),
      expected: reportExpectation(review, evidence.execution),
      revalidateAfterRead: revalidateCurrent,
    });
    if (!bytes) return NOT_FOUND;
    return ok({
      bytes,
      filename: APPROVED_REPORT_FILENAME,
      mime_type: APPROVED_REPORT_MIME,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * The only Drive write path: approved-artifact publication to the matter's
 * Drive folder.
 *
 * Publication is matter-bound, idempotent and fail-closed:
 * - the export must belong to this project, execution and review revision;
 * - the granted scope must still match the execution and still be fresh at the
 *   moment the service uploads and again before it records the outcome;
 * - the artifact bytes are read through the strict storage port and verified
 *   against the recorded SHA-256 before anything leaves the server;
 * - a transport that is not the reviewed fake Drive answers 503, because the
 *   connector's Drive switch and the assistant's Drive tools are the only
 *   other surfaces and both stay off by default.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import type { AuthorizationScope } from "../../lib/recovery/authorization/evaluateAccess";
import { recheckFreshAccessViaPort } from "../../lib/recovery/authorization/tenancyReadPort";
import { createSupabaseTenancyReadPort } from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import {
  createBoundEvidenceResourceScopePort,
  createSupabaseAiReadRepository,
} from "../../lib/recovery/persistence/supabaseAiReadRepository";
import {
  createDrivePublicationPersistence,
  type DrivePublicationIntentDto,
} from "../../lib/recovery/persistence/drivePublicationPersistence";
import {
  createApprovedArtifactPublicationService,
  type ApprovedArtifactDriveTransport,
} from "../../lib/recovery/drive/approvedArtifactPublication";
import type { EvidenceResourceScopePort } from "../../lib/recovery/evidence/appendOnlyEvidence";
import type { HumanReviewExecution } from "../../lib/recovery/review/humanReview";
import {
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import { createApprovedArtifactStorage } from "./ai-recovery.storage";
import { authorizeExecution } from "./ai-recovery.authorization";
import {
  APPROVED_ARTIFACT_EXPORT_COLUMNS,
  isApprovedArtifactExportRow,
  isApprovedArtifactPublicationResult,
  isFakeDriveTransport,
  isRecord,
  publicDrivePublication,
  publicationIntentMatchesAuthorizedContext,
  publicationScopeMatchesExecution,
} from "./ai-recovery.validation";

const NOT_FOUND = {
  ok: false,
  kind: "not_found",
  code: "not_found",
  detail: "Not found.",
} as const;
const MFA_REQUIRED = {
  ok: false,
  kind: "forbidden",
  code: "mfa_required",
  detail: "MFA required.",
} as const;
const AUTHORIZATION_REVOKED = {
  ok: false,
  kind: "forbidden",
  code: "authorization_revoked",
  detail: "Authorization revoked.",
} as const;
const PUBLICATION_UNAVAILABLE = {
  ok: false,
  kind: "unavailable",
  code: "drive_publication_unavailable",
  detail: "Drive publication unavailable.",
} as const;

type PublicationView = ReturnType<typeof publicDrivePublication>;

type AuthorizedContext = {
  identity: AuthenticatedIdentity;
  scope: AuthorizationScope;
  execution: HumanReviewExecution;
  publication_id?: string;
  export_id?: string;
  review_revision?: number;
};

/**
 * The last awaited check before an upload and before the outcome write.
 * Reads the evidence, the resource scope and the tenancy state again; any
 * drift or dependency failure is a refusal, never a stale allow.
 */
function createDriveWriteRevalidator(input: {
  context: AuthorizedContext;
  tenancy: ReturnType<typeof createSupabaseTenancyReadPort>;
  repository: ReturnType<typeof createSupabaseAiReadRepository>;
  resources: EvidenceResourceScopePort;
}) {
  return async ({
    intent,
  }: {
    phase: "before_upload" | "before_record_outcome";
    intent: DrivePublicationIntentDto;
  }): Promise<boolean> => {
    try {
      if (
        !publicationIntentMatchesAuthorizedContext(intent, {
          project_id: input.context.execution.project_id,
          execution: input.context.execution,
          identity: input.context.identity,
          authorization_epoch: input.context.scope.authorization_epoch,
          ...(input.context.publication_id === undefined
            ? {}
            : { publication_id: input.context.publication_id }),
          ...(input.context.export_id === undefined
            ? {}
            : { export_id: input.context.export_id }),
          ...(input.context.review_revision === undefined
            ? {}
            : { review_revision: input.context.review_revision }),
        })
      )
        return false;
      const current = await input.repository.loadExecutionEvidence({
        project_id: input.context.execution.project_id,
        execution_id: input.context.execution.execution_id,
      });
      if (!current) return false;
      for (const key of [
        "execution_id",
        "organization_id",
        "matter_id",
        "project_id",
        "document_id",
        "document_version_id",
        "document_content_sha256",
        "evidence_receipt_sha256",
      ] as const) {
        if (current.execution[key] !== input.context.execution[key])
          return false;
      }
      if (!(await drivePublicationResourceMatches(input.resources, intent)))
        return false;
      // This is the last awaited read: revocation during resource I/O must win.
      const fresh = await recheckFreshAccessViaPort(input.tenancy, {
        scope: input.context.scope,
        identity: input.context.identity,
        requiresMfa: true,
      });
      return (
        fresh.kind !== "authorization_dependency_failed" && fresh.result.fresh
      );
    } catch {
      return false;
    }
  };
}

async function drivePublicationResourceMatches(
  port: EvidenceResourceScopePort,
  intent: DrivePublicationIntentDto,
): Promise<boolean> {
  const resource = await port.getEvidenceResourceScope({
    document_version_id: intent.artifact_document_version_id,
  });
  return (
    isRecord(resource) &&
    resource.organization_id === intent.organization_id &&
    resource.matter_id === intent.matter_id &&
    resource.project_id === intent.project_id &&
    resource.document_id === intent.artifact_document_id &&
    resource.document_version_id === intent.artifact_document_version_id &&
    resource.document_content_sha256 === intent.approved_artifact_sha256
  );
}

/** Read one publication record of an execution the caller may open. */
export async function readDrivePublication(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    publication_id: string;
    identity: AuthenticatedIdentity;
  },
): Promise<ServiceResult<PublicationView>> {
  try {
    const authorized = await authorizeExecution(db, {
      project_id: input.project_id,
      execution_id: input.execution_id,
      identity: input.identity,
      requires_mfa: true,
    });
    if (authorized.kind === "not_found") return NOT_FOUND;
    if (authorized.kind === "mfa_required") return MFA_REQUIRED;
    if (authorized.kind !== "ok") return NOT_FOUND;
    const { evidence, tenancy, scope } = authorized.value;

    const persistence = createDrivePublicationPersistence({
      client: db,
      context: {
        actor_user_id: input.identity.user_id,
        organization_id: scope.organization_id,
        authorization_epoch: scope.authorization_epoch,
      },
    });
    const result = await persistence.read(input.publication_id);
    if (!result) return NOT_FOUND;
    if ("disposition" in result) return NOT_FOUND;

    const intent = result;
    if (
      intent.publication_id !== input.publication_id ||
      intent.execution_id !== input.execution_id ||
      intent.execution_id !== evidence.execution.execution_id ||
      intent.project_id !== input.project_id ||
      intent.project_id !== evidence.execution.project_id ||
      intent.organization_id !== evidence.execution.organization_id ||
      intent.matter_id !== evidence.execution.matter_id
    )
      return NOT_FOUND;

    const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      project_id: input.project_id,
    });
    if (!(await drivePublicationResourceMatches(resourceScopePort, intent)))
      return NOT_FOUND;
    const fresh = await recheckFreshAccessViaPort(tenancy, {
      scope,
      identity: input.identity,
      requiresMfa: true,
    });
    if (fresh.kind === "authorization_dependency_failed")
      throw new Error("AI Drive publication fresh authorization failed");
    if (!fresh.result.fresh) return NOT_FOUND;

    return ok(publicDrivePublication(intent));
  } catch (error) {
    return internalFailure(error);
  }
}

/** Publish the approved artifact of one export to the matter's Drive folder. */
export async function publishApprovedArtifact(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    export_id: string;
    expected_review_revision: number;
    transport: unknown;
  },
): Promise<
  ServiceResult<{
    outcome: string;
    disposition: string;
    publication: PublicationView;
  }>
> {
  try {
    const authorized = await authorizeExecution(db, {
      project_id: input.project_id,
      execution_id: input.execution_id,
      identity: input.identity,
      requires_mfa: true,
    });
    if (authorized.kind === "not_found") return NOT_FOUND;
    if (authorized.kind === "mfa_required") return MFA_REQUIRED;
    if (authorized.kind !== "ok") return AUTHORIZATION_REVOKED;
    const { evidence, repository, tenancy: tenancyPort } = authorized.value;
    const grantedScope = authorized.value.scope;
    if (
      !publicationScopeMatchesExecution(
        grantedScope,
        input.identity,
        evidence.execution,
        input.project_id,
      )
    )
      return NOT_FOUND;

    const exportResult = await db
      .from("ai_review_exports")
      .select(APPROVED_ARTIFACT_EXPORT_COLUMNS)
      .eq("id", input.export_id)
      .eq("project_id", input.project_id)
      .eq("execution_id", input.execution_id)
      .maybeSingle();
    if (exportResult.error)
      throw new Error("AI approved artifact query failed");
    const receivedExport = exportResult.data;
    const exportRow = isRecord(receivedExport)
      ? { ...receivedExport }
      : receivedExport;
    if (
      !isApprovedArtifactExportRow(exportRow, {
        export_id: input.export_id,
        project_id: input.project_id,
        execution_id: input.execution_id,
        review_revision: input.expected_review_revision,
        execution: evidence.execution,
      })
    )
      return NOT_FOUND;

    const transport = input.transport;
    if (!isFakeDriveTransport(transport)) return PUBLICATION_UNAVAILABLE;

    const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      project_id: input.project_id,
    });
    const revalidateAuthorization = createDriveWriteRevalidator({
      context: {
        export_id: input.export_id,
        review_revision: input.expected_review_revision,
        identity: input.identity,
        scope: grantedScope,
        execution: evidence.execution,
      },
      tenancy: tenancyPort,
      repository,
      resources: resourceScopePort,
    });
    const persistence = createDrivePublicationPersistence({
      client: db,
      context: {
        actor_user_id: input.identity.user_id,
        organization_id: grantedScope.organization_id,
        authorization_epoch: grantedScope.authorization_epoch,
      },
    });
    const service = createApprovedArtifactPublicationService({
      persistence,
      storage: createApprovedArtifactStorage(),
      transport: transport as ApprovedArtifactDriveTransport,
      revalidateAuthorization,
    });
    const result = await service.publish({
      export_id: input.export_id,
      review_revision: input.expected_review_revision,
    });
    if (
      !isApprovedArtifactPublicationResult(result, {
        export_id: input.export_id,
        review_revision: input.expected_review_revision,
        project_id: input.project_id,
        execution: evidence.execution,
        identity: input.identity,
        authorization_epoch: grantedScope.authorization_epoch,
      })
    )
      throw new Error("AI Drive publication result mismatch");
    if (
      !(await revalidateAuthorization({
        phase: "before_record_outcome",
        intent: result.intent,
      }))
    )
      return AUTHORIZATION_REVOKED;
    return ok({
      outcome: result.outcome,
      disposition: result.disposition,
      publication: publicDrivePublication(result.intent),
    });
  } catch (error) {
    return internalFailure(error);
  }
}

/** Reconcile a publication whose upload outcome was unknown. */
export async function reconcileDrivePublication(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    publication_id: string;
    identity: AuthenticatedIdentity;
    transport: unknown;
  },
): Promise<
  ServiceResult<{
    outcome: string;
    disposition: string;
    publication: PublicationView;
  }>
> {
  try {
    const authorized = await authorizeExecution(db, {
      project_id: input.project_id,
      execution_id: input.execution_id,
      identity: input.identity,
      requires_mfa: true,
    });
    if (authorized.kind === "not_found") return NOT_FOUND;
    if (authorized.kind === "mfa_required") return MFA_REQUIRED;
    if (authorized.kind !== "ok") return AUTHORIZATION_REVOKED;
    const { evidence, repository } = authorized.value;
    const grantedScope = authorized.value.scope;
    if (
      !publicationScopeMatchesExecution(
        grantedScope,
        input.identity,
        evidence.execution,
        input.project_id,
      )
    )
      return NOT_FOUND;

    const persistence = createDrivePublicationPersistence({
      client: db,
      context: {
        actor_user_id: input.identity.user_id,
        organization_id: grantedScope.organization_id,
        authorization_epoch: grantedScope.authorization_epoch,
      },
    });
    const readback = await persistence.read(input.publication_id);
    if (
      !publicationIntentMatchesAuthorizedContext(readback, {
        publication_id: input.publication_id,
        project_id: input.project_id,
        execution: evidence.execution,
        identity: input.identity,
        authorization_epoch: grantedScope.authorization_epoch,
      })
    )
      return NOT_FOUND;

    const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      project_id: input.project_id,
    });
    if (!(await drivePublicationResourceMatches(resourceScopePort, readback)))
      return NOT_FOUND;
    const transport = input.transport;
    if (!isFakeDriveTransport(transport)) return PUBLICATION_UNAVAILABLE;

    const revalidateAuthorization = createDriveWriteRevalidator({
      context: {
        publication_id: input.publication_id,
        identity: input.identity,
        scope: grantedScope,
        execution: evidence.execution,
      },
      tenancy: authorized.value.tenancy,
      repository,
      resources: resourceScopePort,
    });
    const service = createApprovedArtifactPublicationService({
      persistence,
      storage: createApprovedArtifactStorage(),
      transport: transport as ApprovedArtifactDriveTransport,
      revalidateAuthorization,
    });
    const result = await service.reconcile({
      publication_id: input.publication_id,
    });
    if (
      !isApprovedArtifactPublicationResult(result, {
        publication_id: input.publication_id,
        project_id: input.project_id,
        execution: evidence.execution,
        identity: input.identity,
        authorization_epoch: grantedScope.authorization_epoch,
      })
    )
      throw new Error("AI Drive publication result mismatch");
    if (
      !(await revalidateAuthorization({
        phase: "before_record_outcome",
        intent: result.intent,
      }))
    )
      return AUTHORIZATION_REVOKED;
    return ok({
      outcome: result.outcome,
      disposition: result.disposition,
      publication: publicDrivePublication(result.intent),
    });
  } catch (error) {
    return internalFailure(error);
  }
}

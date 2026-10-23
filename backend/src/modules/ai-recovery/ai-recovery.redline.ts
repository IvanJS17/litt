/**
 * Approved redline bundles: read one revision and append a new one.
 *
 * The bundle's own integrity (canonical JSON, action spans, hashes) is checked
 * again on the way out, so a tampered row is a 409 and never leaves the
 * server. The append path re-derives every action from the reviewed pages and
 * refuses to write if anything drifted since the review.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import { evaluateInitialAccess } from "../../lib/recovery/authorization/tenancyReadPort";
import { createSupabaseTenancyReadPort } from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import {
  createBoundEvidenceResourceScopePort,
  createSupabaseAiReadRepository,
} from "../../lib/recovery/persistence/supabaseAiReadRepository";
import { createSupabaseAiPersistencePorts } from "../../lib/recovery/persistence/supabaseAiPersistencePorts";
import { produceApprovedRedlineBundle } from "../../lib/recovery/review/approvedRedlineBundle";
import {
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import {
  isIntegrityValid,
  isNonEmptyString,
  isRecord,
  publicRedlineBundle,
  REDLINE_BUNDLE_COLUMNS,
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

/** Read one revision of an approved redline bundle. */
export async function readRedlineBundle(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    revision: number;
  },
): Promise<ServiceResult<Record<string, unknown>>> {
  try {
    const result = await db
      .from("ai_redline_bundles")
      .select(REDLINE_BUNDLE_COLUMNS)
      .eq("project_id", input.project_id)
      .eq("execution_id", input.execution_id)
      .eq("revision", input.revision)
      .eq("bundle_version", "approved-redline-v1")
      .maybeSingle();
    if (result.error) throw new Error("AI redline bundle query failed");
    if (
      !isRecord(result.data) ||
      !isNonEmptyString(result.data.organization_id) ||
      !isNonEmptyString(result.data.matter_id)
    )
      return NOT_FOUND;

    const tenancyReadPort = createSupabaseTenancyReadPort(db);
    const access = await evaluateInitialAccess(tenancyReadPort, {
      identity: input.identity,
      organization_id: result.data.organization_id,
      matter_id: result.data.matter_id,
      requiresMfa: false,
    });
    if (access.kind === "authorization_dependency_failed")
      throw new Error("AI redline authorization failed");
    if (access.decision.outcome !== "allow") return NOT_FOUND;

    let rpcResult: { data: unknown; error: unknown };
    try {
      rpcResult = await db.rpc("assert_ai_redline_bundle_access", {
        p_bundle_id: result.data.id,
        p_actor_user_id: input.identity.user_id,
        p_organization_id: result.data.organization_id,
        p_authorization_epoch: access.decision.scope.authorization_epoch,
        p_intent: "read",
      });
    } catch {
      throw new Error("AI redline authorization RPC failed");
    }
    if (
      rpcResult.error &&
      isRecord(rpcResult.error) &&
      rpcResult.error.code === "42501"
    )
      return AUTHORIZATION_REVOKED;
    if (rpcResult.error || rpcResult.data !== true)
      throw new Error("AI redline authorization RPC failed");
    if (
      !isIntegrityValid(
        result.data,
        input.project_id,
        input.execution_id,
        input.revision,
      )
    )
      return {
        ok: false,
        kind: "conflict",
        code: "redline_bundle_integrity_failed",
        detail: "Redline bundle integrity failed.",
      };

    return ok(publicRedlineBundle(result.data));
  } catch (error) {
    return internalFailure(error);
  }
}

/** Append the bundle produced from the approved review's accepted items. */
export async function appendRedlineBundle(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    idempotency_key: string;
    revision: number;
    expected_review_revision: number;
  },
): Promise<
  ServiceResult<{ bundle: unknown; receipt: { disposition: string } }>
> {
  try {
    const repository = createSupabaseAiReadRepository(db);
    const evidence = await repository.loadExecutionEvidence({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!evidence) return NOT_FOUND;

    const tenancyReadPort = createSupabaseTenancyReadPort(db);
    const access = await evaluateInitialAccess(tenancyReadPort, {
      identity: input.identity,
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      requiresMfa: true,
    });
    if (access.kind === "authorization_dependency_failed")
      throw new Error("AI approved redline authorization failed");
    if (access.decision.outcome === "not_found") return NOT_FOUND;
    if (access.decision.outcome === "denied") {
      return access.decision.code === "mfa_required"
        ? MFA_REQUIRED
        : AUTHORIZATION_REVOKED;
    }

    const review = await repository.loadReview({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!review) return NOT_FOUND;
    const sourceVersion = await repository.loadSourceVersion({
      document_version_id: evidence.execution.document_version_id,
    });
    if (!sourceVersion) return NOT_FOUND;
    const pages = await repository.loadPages({
      document_version_id: evidence.execution.document_version_id,
    });
    const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      project_id: input.project_id,
    });
    const mutationPort = createSupabaseAiPersistencePorts(db, {
      actor_user_id: input.identity.user_id,
      organization_id: access.decision.scope.organization_id,
      authorization_epoch: access.decision.scope.authorization_epoch,
    }).redline;
    const result = await produceApprovedRedlineBundle({
      identity: input.identity,
      granted_scope: access.decision.scope,
      tenancy_port: tenancyReadPort,
      resource_scope_port: resourceScopePort,
      requires_mfa: true,
      idempotency_key: input.idempotency_key,
      revision: input.revision,
      expected_review_revision: input.expected_review_revision,
      review,
      execution: evidence.execution,
      evidence_receipt: evidence.evidence_receipt,
      source_version: sourceVersion,
      pages,
      append_port: mutationPort,
    });
    if (!result.ok) {
      if (result.error_class === "invalid_approved_redline")
        return {
          ok: false,
          kind: "conflict",
          code: "invalid_approved_redline",
          detail: "Invalid approved redline.",
        };
      if (result.error_class === "approved_redline_authorization_failed")
        return AUTHORIZATION_REVOKED;
      throw new Error("AI approved redline operation failed");
    }
    return ok({ bundle: result.bundle, receipt: result.receipt });
  } catch (error) {
    return internalFailure(error);
  }
}

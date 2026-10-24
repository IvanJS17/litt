/**
 * Human review mutations: create the review, decide one item, complete it.
 *
 * Reviewer separation and the "reviewer is not the execution author" rule live
 * in `lib/recovery/review/humanReview`; this module owns the request-derived
 * plumbing and the mapping from typed domain failures onto service failures.
 * Every mutation rechecks the granted scope immediately before writing.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import { createSupabaseTenancyReadPort } from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import type { AuthorizationScope } from "../../lib/recovery/authorization/evaluateAccess";
import { evaluateInitialAccess } from "../../lib/recovery/authorization/tenancyReadPort";
import {
  createBoundEvidenceResourceScopePort,
  createSupabaseAiReadRepository,
} from "../../lib/recovery/persistence/supabaseAiReadRepository";
import { createSupabaseAiPersistencePorts } from "../../lib/recovery/persistence/supabaseAiPersistencePorts";
import {
  completeHumanReview,
  createHumanReview,
  decideHumanReviewItem,
  type HumanReview,
  type HumanReviewMutationPort,
  type HumanReviewExecution,
} from "../../lib/recovery/review/humanReview";
import type { EvidenceResourceScopePort } from "../../lib/recovery/evidence/appendOnlyEvidence";
import {
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { AiExecutionEvidence } from "./ai-recovery.types";

const NOT_FOUND = {
  ok: false,
  kind: "not_found",
  code: "not_found",
  detail: "Not found.",
} as const;
const INVALID_REVIEW = {
  ok: false,
  kind: "validation",
  code: "invalid_review",
  detail: "Invalid review.",
} as const;
const AUTHORIZATION_REVOKED = {
  ok: false,
  kind: "forbidden",
  code: "authorization_revoked",
  detail: "Authorization revoked.",
} as const;
const MFA_REQUIRED = {
  ok: false,
  kind: "forbidden",
  code: "mfa_required",
  detail: "MFA required.",
} as const;

type ReviewMutationContext =
  | {
      kind: "ready";
      identity: AuthenticatedIdentity;
      granted_scope: AuthorizationScope;
      tenancy_port: ReturnType<typeof createSupabaseTenancyReadPort>;
      resource_scope_port: EvidenceResourceScopePort;
      mutation_port: HumanReviewMutationPort;
      review: HumanReview;
      evidence: AiExecutionEvidence;
      execution: HumanReviewExecution;
    }
  | { kind: "not_found" }
  | { kind: "mfa_required" }
  | { kind: "denied" };

/**
 * Rebuild the mutation context for an execution the caller is reviewing:
 * evidence, matter gate with MFA, the reviewer's own review, and the ports a
 * mutation needs. A reviewer who is not the caller is a deny, not a 404: the
 * existence of the review is already known to them through the read path.
 */
async function loadReviewMutationContext(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
  },
): Promise<ReviewMutationContext> {
  const repository = createSupabaseAiReadRepository(db);
  const evidence = await repository.loadExecutionEvidence({
    project_id: input.project_id,
    execution_id: input.execution_id,
  });
  if (!evidence) return { kind: "not_found" };

  const tenancyReadPort = createSupabaseTenancyReadPort(db);
  const access = await evaluateInitialAccess(tenancyReadPort, {
    identity: input.identity,
    organization_id: evidence.execution.organization_id,
    matter_id: evidence.execution.matter_id,
    requiresMfa: true,
  });
  if (access.kind === "authorization_dependency_failed")
    throw new Error("AI review authorization failed");
  if (access.decision.outcome === "not_found") return { kind: "not_found" };
  if (access.decision.outcome === "denied") {
    return access.decision.code === "mfa_required"
      ? { kind: "mfa_required" }
      : { kind: "denied" };
  }

  const review = await repository.loadReview({
    project_id: input.project_id,
    execution_id: input.execution_id,
  });
  if (!review) return { kind: "not_found" };
  if (review.reviewer_user_id !== input.identity.user_id)
    return { kind: "denied" };

  const resourceScopePort = createBoundEvidenceResourceScopePort(db, {
    organization_id: evidence.execution.organization_id,
    matter_id: evidence.execution.matter_id,
    project_id: input.project_id,
  });
  const mutationPort = createSupabaseAiPersistencePorts(db, {
    actor_user_id: input.identity.user_id,
    organization_id: access.decision.scope.organization_id,
    authorization_epoch: access.decision.scope.authorization_epoch,
  }).review;
  return {
    kind: "ready",
    identity: input.identity,
    granted_scope: access.decision.scope,
    tenancy_port: tenancyReadPort,
    resource_scope_port: resourceScopePort,
    mutation_port: mutationPort,
    review,
    evidence,
    execution: evidence.execution,
  };
}

function contextFailure(
  context: Exclude<ReviewMutationContext, { kind: "ready" }>,
): ServiceResult<never> {
  if (context.kind === "not_found") return NOT_FOUND;
  if (context.kind === "mfa_required") return MFA_REQUIRED;
  return AUTHORIZATION_REVOKED;
}

function mutationFailure(errorClass: string): ServiceResult<never> {
  if (errorClass === "invalid_review") return INVALID_REVIEW;
  if (errorClass === "review_authorization_failed")
    return AUTHORIZATION_REVOKED;
  throw new Error("AI review operation failed");
}

/** Open a human review of one execution. */
export async function createReview(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    idempotency_key: string;
    review_id: string;
  },
): Promise<
  ServiceResult<{ review: HumanReview; receipt: { disposition: string } }>
> {
  try {
    const context = await loadReviewMutationContext(db, {
      project_id: input.project_id,
      execution_id: input.execution_id,
      identity: input.identity,
    });
    if (context.kind !== "ready") return contextFailure(context);

    const result = await createHumanReview({
      identity: context.identity,
      granted_scope: context.granted_scope,
      tenancy_port: context.tenancy_port,
      resource_scope_port: context.resource_scope_port,
      requires_mfa: true,
      idempotency_key: input.idempotency_key,
      review_id: input.review_id,
      execution: context.evidence.execution,
      evidence_receipt: context.evidence.evidence_receipt,
      mutation_port: context.mutation_port,
    });
    if (!result.ok) return mutationFailure(result.error_class);
    return ok({ review: result.review, receipt: result.receipt });
  } catch (error) {
    return internalFailure(error);
  }
}

/** Accept, reject or edit one finding of the review the caller owns. */
export async function decideReviewItem(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    item_id: string;
    identity: AuthenticatedIdentity;
    idempotency_key: string;
    decision: "accepted" | "rejected" | "edited";
    finding_text?: unknown;
    comment?: unknown;
  },
): Promise<
  ServiceResult<{
    review: HumanReview;
    transition: unknown;
    receipt: { disposition: string };
  }>
> {
  try {
    const context = await loadReviewMutationContext(db, {
      project_id: input.project_id,
      execution_id: input.execution_id,
      identity: input.identity,
    });
    if (context.kind !== "ready") return contextFailure(context);

    const result = await decideHumanReviewItem({
      identity: context.identity,
      granted_scope: context.granted_scope,
      tenancy_port: context.tenancy_port,
      resource_scope_port: context.resource_scope_port,
      requires_mfa: true,
      idempotency_key: input.idempotency_key,
      review: context.review,
      item_id: input.item_id,
      decision: input.decision,
      ...(input.finding_text === undefined
        ? {}
        : { finding_text: input.finding_text }),
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      mutation_port: context.mutation_port,
    });
    if (!result.ok) return mutationFailure(result.error_class);
    return ok({
      review: result.review,
      transition: result.transition,
      receipt: result.receipt,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

/** Move the review to a terminal state (approved or changes requested). */
export async function completeReview(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    idempotency_key: string;
    terminal_state: "approved" | "changes_requested";
  },
): Promise<
  ServiceResult<{ review: HumanReview; receipt: { disposition: string } }>
> {
  try {
    const context = await loadReviewMutationContext(db, {
      project_id: input.project_id,
      execution_id: input.execution_id,
      identity: input.identity,
    });
    if (context.kind !== "ready") return contextFailure(context);

    const result = await completeHumanReview({
      identity: context.identity,
      granted_scope: context.granted_scope,
      tenancy_port: context.tenancy_port,
      resource_scope_port: context.resource_scope_port,
      requires_mfa: true,
      idempotency_key: input.idempotency_key,
      review: context.review,
      execution: context.execution,
      terminal_state: input.terminal_state,
      mutation_port: context.mutation_port,
    });
    if (!result.ok) return mutationFailure(result.error_class);
    return ok({ review: result.review, receipt: result.receipt });
  } catch (error) {
    return internalFailure(error);
  }
}

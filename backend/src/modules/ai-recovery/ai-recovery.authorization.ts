/**
 * One fail-closed authorization preamble for the AI evidence surface.
 *
 * Every handler binds an execution to the caller the same way: load the
 * execution's own evidence, evaluate the LiTT matter gate for the organization
 * and matter that belong to it, and hand back the granted scope the write
 * paths recheck before mutating. This module keeps that order in one place so
 * a later handler cannot skip a step or invent a different mapping.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import type { AuthorizationScope } from "../../lib/recovery/authorization/evaluateAccess";
import {
  createSupabaseTenancyReadPort,
} from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import { evaluateInitialAccess } from "../../lib/recovery/authorization/tenancyReadPort";
import {
  createSupabaseAiReadRepository,
} from "../../lib/recovery/persistence/supabaseAiReadRepository";
import type { AiExecutionEvidence } from "./ai-recovery.types";

export type AuthorizedExecution = {
  evidence: AiExecutionEvidence;
  tenancy: ReturnType<typeof createSupabaseTenancyReadPort>;
  repository: ReturnType<typeof createSupabaseAiReadRepository>;
  scope: AuthorizationScope;
};

export type AuthorizationOutcome =
  | { kind: "ok"; value: AuthorizedExecution }
  | { kind: "not_found" }
  | { kind: "mfa_required" }
  | { kind: "denied" };

/**
 * Load the execution evidence and evaluate the matter gate for it. Reads with
 * `requiresMfa: false` are the public read paths; every write and every
 * Drive/publication read requires a satisfied second factor.
 */
export async function authorizeExecution(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
    requires_mfa: boolean;
  },
): Promise<AuthorizationOutcome> {
  const repository = createSupabaseAiReadRepository(db);
  const evidence = await repository.loadExecutionEvidence({
    project_id: input.project_id,
    execution_id: input.execution_id,
  });
  if (!evidence) return { kind: "not_found" };
  // The repository already filters by both ids; this keeps the binding true
  // for any injected read port, so a mismatched row can never reach a claim.
  if (
    evidence.execution.execution_id !== input.execution_id ||
    evidence.execution.project_id !== input.project_id
  )
    return { kind: "not_found" };

  const tenancy = createSupabaseTenancyReadPort(db);
  const access = await evaluateInitialAccess(tenancy, {
    identity: input.identity,
    organization_id: evidence.execution.organization_id,
    matter_id: evidence.execution.matter_id,
    requiresMfa: input.requires_mfa,
  });
  if (access.kind === "authorization_dependency_failed") {
    throw new Error("AI evidence authorization failed");
  }
  if (access.decision.outcome === "not_found") return { kind: "not_found" };
  if (access.decision.outcome === "denied") {
    return access.decision.code === "mfa_required"
      ? { kind: "mfa_required" }
      : { kind: "denied" };
  }
  return {
    kind: "ok",
    value: {
      evidence,
      tenancy,
      repository,
      scope: access.decision.scope,
    },
  };
}

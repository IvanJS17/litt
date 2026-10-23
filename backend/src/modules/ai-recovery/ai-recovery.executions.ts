/**
 * Reading AI executions: the project-scoped listing and one execution's
 * human review.
 *
 * Both are level-1 reads: the matter gate is evaluated for the execution row
 * itself, so a listing can only ever show what the caller may open today, and
 * a missing or forbidden row answers the same opaque 404.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import { evaluateInitialAccess } from "../../lib/recovery/authorization/tenancyReadPort";
import { createSupabaseTenancyReadPort } from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import { createSupabaseAiReadRepository } from "../../lib/recovery/persistence/supabaseAiReadRepository";
import type { HumanReview } from "../../lib/recovery/review/humanReview";
import {
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import {
  EXECUTION_COLUMNS,
  EXECUTION_STATUSES,
  isNonEmptyString,
  isNullableString,
  isRecord,
  isSha256,
} from "./ai-recovery.validation";

export type AiExecutionSummary = {
  id: string;
  project_id: string;
  matter_id: string;
  document_id: string;
  document_version_id: string;
  document_content_sha256: string;
  status: string;
  error_class: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function isValidExecutionRow(
  row: unknown,
  projectId: string,
): row is {
  id: string;
  project_id: string;
  organization_id: string;
  matter_id: string;
  document_id: string;
  document_version_id: string;
  document_content_sha256: string;
  status: string;
  error_class: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
} {
  if (!isRecord(row)) return false;
  return (
    isNonEmptyString(row.id) &&
    row.project_id === projectId &&
    row.evidence_version === "evidence-v1" &&
    isNonEmptyString(row.organization_id) &&
    isNonEmptyString(row.matter_id) &&
    isNonEmptyString(row.document_id) &&
    isNonEmptyString(row.document_version_id) &&
    isSha256(row.document_content_sha256) &&
    typeof row.status === "string" &&
    EXECUTION_STATUSES.has(row.status) &&
    isNullableString(row.error_class) &&
    isNonEmptyString(row.created_at) &&
    isNullableString(row.started_at) &&
    isNullableString(row.finished_at)
  );
}

function toSummary(row: {
  id: string;
  project_id: string;
  matter_id: string;
  document_id: string;
  document_version_id: string;
  document_content_sha256: string;
  status: string;
  error_class: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}): AiExecutionSummary {
  return {
    id: row.id,
    project_id: row.project_id,
    matter_id: row.matter_id,
    document_id: row.document_id,
    document_version_id: row.document_version_id,
    document_content_sha256: row.document_content_sha256,
    status: row.status,
    error_class: row.error_class,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

/**
 * Executions recorded for one project that the caller may still open.
 *
 * The query is project-scoped and version-filtered; the matter gate then runs
 * per row, so a member who lost a private matter stops seeing its evidence
 * without the listing learning that the row exists.
 */
export async function listExecutions(
  db: Db,
  input: { project_id: string; identity: AuthenticatedIdentity },
): Promise<ServiceResult<AiExecutionSummary[]>> {
  try {
    const { data, error } = await db
      .from("ai_executions")
      .select(EXECUTION_COLUMNS)
      .eq("project_id", input.project_id)
      .eq("evidence_version", "evidence-v1")
      .order("created_at", { ascending: false });

    if (error || !Array.isArray(data)) {
      throw new Error("AI execution listing query failed");
    }

    const tenancyReadPort = createSupabaseTenancyReadPort(db);
    const executions: AiExecutionSummary[] = [];
    for (const candidate of data) {
      if (!isValidExecutionRow(candidate, input.project_id)) continue;

      const access = await evaluateInitialAccess(tenancyReadPort, {
        identity: input.identity,
        organization_id: candidate.organization_id,
        matter_id: candidate.matter_id,
        requiresMfa: false,
      });

      if (access.kind === "authorization_dependency_failed") {
        throw new Error("AI execution authorization failed");
      }
      if (access.decision.outcome !== "allow") continue;
      executions.push(toSummary(candidate));
    }

    return ok(executions);
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * The human review of one execution. Reading is a level-1 operation: the
 * matter gate alone decides, and any gap is the same opaque 404.
 */
export async function readReview(
  db: Db,
  input: {
    project_id: string;
    execution_id: string;
    identity: AuthenticatedIdentity;
  },
): Promise<ServiceResult<HumanReview>> {
  try {
    const repository = createSupabaseAiReadRepository(db);
    const evidence = await repository.loadExecutionEvidence({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!evidence) return { ok: false, kind: "not_found", code: "not_found", detail: "Not found." };

    const tenancyReadPort = createSupabaseTenancyReadPort(db);
    const access = await evaluateInitialAccess(tenancyReadPort, {
      identity: input.identity,
      organization_id: evidence.execution.organization_id,
      matter_id: evidence.execution.matter_id,
      requiresMfa: false,
    });
    if (access.kind === "authorization_dependency_failed")
      throw new Error("AI review authorization failed");
    if (access.decision.outcome !== "allow")
      return { ok: false, kind: "not_found", code: "not_found", detail: "Not found." };

    const review = await repository.loadReview({
      project_id: input.project_id,
      execution_id: input.execution_id,
    });
    if (!review) return { ok: false, kind: "not_found", code: "not_found", detail: "Not found." };
    return ok(review);
  } catch (error) {
    return internalFailure(error);
  }
}

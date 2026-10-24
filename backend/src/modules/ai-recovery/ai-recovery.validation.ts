/**
 * Wire-level validation for the AI evidence module.
 *
 * Everything here is pure: it reads one already-fetched row or request body
 * and answers whether its shape is exactly the one the approved-artifact and
 * evidence contracts allow. No database client, no HTTP objects. Splitting it
 * out of the handlers keeps the SQL-facing topic files readable and gives the
 * route layer a single place to look for "what does the client get back".
 */

import { createHash } from "node:crypto";

import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import type { HumanReviewExecution } from "../../lib/recovery/review/humanReview";
import type { ApprovedArtifactDriveTransport } from "../../lib/recovery/drive/approvedArtifactPublication";
import type { DrivePublicationIntentDto } from "../../lib/recovery/persistence/drivePublicationPersistence";

export const EXECUTION_COLUMNS =
  "id, project_id, evidence_version, organization_id, matter_id, document_id, document_version_id, document_content_sha256, status, error_class, created_at, started_at, finished_at";

export const EXECUTION_STATUSES = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const REDLINE_BUNDLE_COLUMNS =
  "id, bundle_version, revision, review_id, review_revision, execution_id, organization_id, matter_id, project_id, document_id, document_version_id, source_document_sha256, evidence_receipt_version, evidence_receipt_sha256, reviewer_user_id, actions, canonical_json, bundle_sha256";
export const REDLINE_BUNDLE_KEYS = [
  "bundle_version",
  "revision",
  "review_id",
  "review_revision",
  "execution_id",
  "organization_id",
  "matter_id",
  "project_id",
  "document_id",
  "document_version_id",
  "source_document_sha256",
  "evidence_receipt_version",
  "evidence_receipt_sha256",
  "reviewer_user_id",
  "actions",
  "canonical_json",
  "bundle_sha256",
] as const;
const REDLINE_ACTION_KEYS = [
  "action_id",
  "review_item_id",
  "citation_id",
  "document_id",
  "document_version_id",
  "page",
  "start",
  "end",
  "page_content_sha256",
  "before_text_sha256",
  "replacement_text_sha256",
] as const;
const REDLINE_FULL_ACTION_KEYS = [
  ...REDLINE_ACTION_KEYS,
  "replacement_text",
] as const;

export const APPROVED_ARTIFACT_EXPORT_COLUMNS =
  "id,idempotency_key,review_id,review_revision,execution_id,organization_id,matter_id,project_id,source_document_id,source_document_version_id,artifact_document_id,artifact_document_version_id,source_document_sha256,evidence_receipt_sha256,filename,mime_type,artifact_sha256,storage_path,size_bytes";
export const APPROVED_ARTIFACT_EXPORT_KEYS =
  APPROVED_ARTIFACT_EXPORT_COLUMNS.split(",");
export const DRIVE_PUBLICATION_OUTCOMES = [
  "pending",
  "uploaded",
  "unknown_outcome",
  "reconciled",
  "failed",
] as const;
export const DRIVE_PUBLICATION_DISPOSITIONS = [
  "uploaded",
  "replayed",
  "reconciled",
  "failed",
  "unknown_outcome",
] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isPostgresUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isValidActionIdentity(action: Record<string, unknown>): boolean {
  return (
    [
      "action_id",
      "review_item_id",
      "citation_id",
      "document_id",
      "document_version_id",
    ].every((key) => isNonEmptyString(action[key])) &&
    Number.isSafeInteger(action.page) &&
    (action.page as number) >= 1 &&
    Number.isSafeInteger(action.start) &&
    (action.start as number) >= 0 &&
    Number.isSafeInteger(action.end) &&
    (action.end as number) > (action.start as number) &&
    isSha256(action.page_content_sha256) &&
    isSha256(action.before_text_sha256) &&
    isSha256(action.replacement_text_sha256)
  );
}

export function isIntegrityValid(
  row: Record<string, unknown>,
  projectId: string,
  executionId: string,
  requestedRevision: number,
): boolean {
  if (
    !hasExactKeys(row, ["id", ...REDLINE_BUNDLE_KEYS]) ||
    !isNonEmptyString(row.id)
  )
    return false;
  if (
    row.bundle_version !== "approved-redline-v1" ||
    row.execution_id !== executionId ||
    row.project_id !== projectId ||
    row.revision !== requestedRevision ||
    !Number.isSafeInteger(row.revision) ||
    (row.revision as number) < 1 ||
    !Number.isSafeInteger(row.review_revision) ||
    (row.review_revision as number) < 1 ||
    row.evidence_receipt_version !== "evidence-v1" ||
    ![
      "review_id",
      "organization_id",
      "matter_id",
      "document_id",
      "document_version_id",
      "reviewer_user_id",
    ].every((key) => isNonEmptyString(row[key])) ||
    !isSha256(row.source_document_sha256) ||
    !isSha256(row.evidence_receipt_sha256) ||
    !isSha256(row.bundle_sha256) ||
    typeof row.canonical_json !== "string" ||
    !Array.isArray(row.actions)
  )
    return false;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.canonical_json);
    if (!isRecord(parsed)) return false;
    body = parsed;
  } catch {
    return false;
  }
  if (
    !hasExactKeys(
      body,
      REDLINE_BUNDLE_KEYS.filter(
        (key) => key !== "canonical_json" && key !== "bundle_sha256",
      ),
    ) ||
    canonical(body) !== row.canonical_json ||
    sha256(row.canonical_json) !== row.bundle_sha256
  )
    return false;
  for (const key of REDLINE_BUNDLE_KEYS.filter(
    (item) =>
      item !== "actions" &&
      item !== "canonical_json" &&
      item !== "bundle_sha256",
  )) {
    if (row[key] !== body[key]) return false;
  }
  if (
    !Array.isArray(body.actions) ||
    body.actions.length !== row.actions.length ||
    body.actions.length === 0
  )
    return false;
  const canonicalById = new Map<string, Record<string, unknown>>();
  for (const action of body.actions) {
    if (
      !isRecord(action) ||
      !hasExactKeys(action, REDLINE_ACTION_KEYS) ||
      !isValidActionIdentity(action) ||
      canonicalById.has(action.action_id as string)
    )
      return false;
    canonicalById.set(action.action_id as string, action);
  }
  const seen = new Set<string>();
  for (const action of row.actions) {
    if (
      !isRecord(action) ||
      !hasExactKeys(action, REDLINE_FULL_ACTION_KEYS) ||
      !isValidActionIdentity(action) ||
      seen.has(action.action_id as string)
    )
      return false;
    const identity = canonicalById.get(action.action_id as string);
    if (
      !identity ||
      REDLINE_ACTION_KEYS.some((key) => action[key] !== identity[key]) ||
      typeof action.replacement_text !== "string" ||
      !isSha256(action.replacement_text_sha256) ||
      sha256(action.replacement_text) !== action.replacement_text_sha256
    )
      return false;
    seen.add(action.action_id as string);
  }
  return seen.size === canonicalById.size;
}

export function publicRedlineBundle(row: Record<string, unknown>) {
  return {
    bundle_version: row.bundle_version,
    revision: row.revision,
    review_id: row.review_id,
    review_revision: row.review_revision,
    execution_id: row.execution_id,
    organization_id: row.organization_id,
    matter_id: row.matter_id,
    project_id: row.project_id,
    document_id: row.document_id,
    document_version_id: row.document_version_id,
    source_document_sha256: row.source_document_sha256,
    evidence_receipt_version: row.evidence_receipt_version,
    evidence_receipt_sha256: row.evidence_receipt_sha256,
    reviewer_user_id: row.reviewer_user_id,
    actions: row.actions,
    canonical_json: row.canonical_json,
    bundle_sha256: row.bundle_sha256,
  };
}

export function publicDrivePublication(intent: DrivePublicationIntentDto) {
  return {
    publication_id: intent.publication_id,
    export_id: intent.export_id,
    execution_id: intent.execution_id,
    review_revision: intent.review_revision,
    revision: intent.revision,
    outcome: intent.outcome,
    attempts: intent.attempts,
    approved_artifact_sha256: intent.approved_artifact_sha256,
    provider_file_id: intent.provider_file_id ?? null,
    failure_code: intent.failure_code,
  };
}

export function isFakeDriveTransport(
  value: unknown,
): value is ApprovedArtifactDriveTransport {
  return (
    isRecord(value) &&
    value.kind === "fake" &&
    value.host === "fake" &&
    typeof value.upload === "function" &&
    typeof value.find === "function"
  );
}

export function isApprovedArtifactExportRow(
  value: unknown,
  input: {
    export_id: string;
    project_id: string;
    execution_id: string;
    review_revision: number;
    execution: HumanReviewExecution;
  },
): value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, APPROVED_ARTIFACT_EXPORT_KEYS))
    return false;
  return (
    value.id === input.export_id &&
    value.project_id === input.project_id &&
    value.execution_id === input.execution_id &&
    value.review_revision === input.review_revision &&
    value.organization_id === input.execution.organization_id &&
    value.matter_id === input.execution.matter_id &&
    value.source_document_id === input.execution.document_id &&
    value.source_document_version_id === input.execution.document_version_id &&
    value.source_document_sha256 === input.execution.document_content_sha256 &&
    value.evidence_receipt_sha256 === input.execution.evidence_receipt_sha256 &&
    isPostgresUuid(value.id) &&
    isPostgresUuid(value.review_id) &&
    isPostgresUuid(value.execution_id) &&
    isPostgresUuid(value.organization_id) &&
    isPostgresUuid(value.matter_id) &&
    isPostgresUuid(value.project_id) &&
    isPostgresUuid(value.source_document_id) &&
    isPostgresUuid(value.source_document_version_id) &&
    isPostgresUuid(value.artifact_document_id) &&
    isPostgresUuid(value.artifact_document_version_id) &&
    isSha256(value.source_document_sha256) &&
    isSha256(value.evidence_receipt_sha256) &&
    isSha256(value.artifact_sha256) &&
    isNonEmptyString(value.idempotency_key) &&
    isNonEmptyString(value.filename) &&
    isNonEmptyString(value.mime_type) &&
    isNonEmptyString(value.storage_path) &&
    Number.isSafeInteger(value.review_revision) &&
    (value.review_revision as number) >= 1 &&
    Number.isSafeInteger(value.size_bytes) &&
    (value.size_bytes as number) > 0 &&
    value.storage_path ===
      `orgs/${value.organization_id}/matters/${value.matter_id}/projects/${value.project_id}/documents/${value.artifact_document_id}/${value.artifact_sha256}.docx`
  );
}

export function publicationIntentMatchesAuthorizedContext(
  value: unknown,
  input: {
    publication_id?: string;
    export_id?: string;
    review_revision?: number;
    project_id: string;
    execution: HumanReviewExecution;
    identity: AuthenticatedIdentity;
    authorization_epoch: number;
  },
): value is DrivePublicationIntentDto {
  if (!isRecord(value)) return false;
  return (
    (input.publication_id === undefined ||
      value.publication_id === input.publication_id) &&
    (input.export_id === undefined || value.export_id === input.export_id) &&
    (input.review_revision === undefined ||
      value.review_revision === input.review_revision) &&
    value.execution_id === input.execution.execution_id &&
    value.project_id === input.project_id &&
    value.organization_id === input.execution.organization_id &&
    value.matter_id === input.execution.matter_id &&
    value.actor_user_id === input.identity.user_id &&
    value.authorization_epoch === input.authorization_epoch &&
    isPostgresUuid(value.publication_id) &&
    isPostgresUuid(value.export_id) &&
    isPostgresUuid(value.review_id) &&
    isPostgresUuid(value.execution_id) &&
    isPostgresUuid(value.matter_id) &&
    isPostgresUuid(value.project_id) &&
    isPostgresUuid(value.organization_id) &&
    isPostgresUuid(value.actor_user_id) &&
    isPostgresUuid(value.artifact_document_id) &&
    isPostgresUuid(value.artifact_document_version_id) &&
    isPostgresUuid(value.source_document_id) &&
    isPostgresUuid(value.source_document_version_id) &&
    value.source_document_id === input.execution.document_id &&
    value.source_document_version_id === input.execution.document_version_id &&
    Number.isSafeInteger(value.authorization_epoch) &&
    (value.authorization_epoch as number) >= 0 &&
    Number.isSafeInteger(value.review_revision) &&
    (value.review_revision as number) >= 1 &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    Number.isSafeInteger(value.attempts) &&
    (value.attempts as number) >= 1 &&
    (value.attempts as number) <= 3 &&
    typeof value.outcome === "string" &&
    (DRIVE_PUBLICATION_OUTCOMES as readonly unknown[]).includes(
      value.outcome,
    ) &&
    isSha256(value.approved_artifact_sha256) &&
    isNonEmptyString(value.artifact_storage_path) &&
    value.artifact_storage_path ===
      `orgs/${value.organization_id}/matters/${value.matter_id}/projects/${value.project_id}/documents/${value.artifact_document_id}/${value.approved_artifact_sha256}.docx` &&
    isNonEmptyString(value.matter_folder_id) &&
    isNonEmptyString(value.idempotency_key) &&
    Number.isSafeInteger(value.artifact_size_bytes) &&
    (value.artifact_size_bytes as number) > 0
  );
}

export function isApprovedArtifactPublicationResult(
  value: unknown,
  input: Parameters<typeof publicationIntentMatchesAuthorizedContext>[1],
): value is {
  disposition: (typeof DRIVE_PUBLICATION_DISPOSITIONS)[number];
  outcome: (typeof DRIVE_PUBLICATION_OUTCOMES)[number];
  intent: DrivePublicationIntentDto;
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["disposition", "outcome", "intent"])
  )
    return false;
  return (
    (DRIVE_PUBLICATION_DISPOSITIONS as readonly unknown[]).includes(
      value.disposition,
    ) &&
    (DRIVE_PUBLICATION_OUTCOMES as readonly unknown[]).includes(
      value.outcome,
    ) &&
    value.outcome ===
      (isRecord(value.intent) ? value.intent.outcome : undefined) &&
    publicationIntentMatchesAuthorizedContext(value.intent, input)
  );
}

export function publicationScopeMatchesExecution(
  scope: {
    user_id: string;
    organization_id: string;
    matter_id: string;
    project_id?: string;
  },
  identity: AuthenticatedIdentity,
  execution: HumanReviewExecution,
  projectId: string,
): boolean {
  return (
    scope.user_id === identity.user_id &&
    scope.organization_id === execution.organization_id &&
    scope.matter_id === execution.matter_id &&
    execution.project_id === projectId &&
    (scope.project_id === undefined || scope.project_id === projectId)
  );
}

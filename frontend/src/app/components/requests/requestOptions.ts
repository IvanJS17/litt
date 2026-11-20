import type {
  MatterRequest,
  MatterRequestComplexity,
  MatterRequestDetail,
  MatterRequestEvent,
  MatterRequestLevel,
  MatterRequestStatus,
  MatterRequestType,
  MatterRequestTypeSeed,
} from "@mike/contracts";

/** The states a request moves through, in the order a lawyer reads them. */
export const REQUEST_STATUSES: readonly MatterRequestStatus[] = [
  "received",
  "in_review",
  "with_client",
  "with_counterparty",
  "closed",
  "cancelled",
];
export const REQUEST_COMPLEXITIES: readonly MatterRequestComplexity[] = [
  "routine",
  "standard",
  "complex",
];
export const REQUEST_LEVELS: readonly MatterRequestLevel[] = [
  "apprentice",
  "junior",
  "senior",
  "partner",
];
export const REQUEST_TYPE_SEEDS: readonly MatterRequestTypeSeed[] = [
  "contracts_clients",
  "contracts_suppliers",
  "intellectual_property",
  "shareholder_meetings",
  "corporate_books",
  "other",
];
export const REQUEST_EVENT_ACTIONS: readonly MatterRequestEvent["action"][] = [
  "created",
  "edited",
  "status_changed",
  "assigned",
  "unassigned",
  "round_linked",
  "round_unlinked",
  "triage_proposed",
  "triage_accepted",
  "triage_edited",
  "triage_discarded",
];

export const TITLE_MAX = 160;
export const TYPE_NAME_MAX = 80;

/** A closed or cancelled request is finished: the list reads it apart from the open ones. */
export function isFinished(status: MatterRequestStatus): boolean {
  return status === "closed" || status === "cancelled";
}

/** What names a type: the firm's own word, or the default's, worded by the reader's language. */
export function typeName(
  type: Pick<MatterRequestType, "name" | "seed_key">,
  seedLabel: (seed: MatterRequestTypeSeed) => string,
): string {
  if (type.name) return type.name;
  return type.seed_key ? seedLabel(type.seed_key) : "";
}

/** The list row of a detail the server just answered (the rounds and events stay in the detail). */
export function rowOf(detail: MatterRequestDetail): MatterRequest {
  return {
    id: detail.id,
    matter_id: detail.matter_id,
    type_id: detail.type_id,
    title: detail.title,
    complexity: detail.complexity,
    status: detail.status,
    assignee_user_id: detail.assignee_user_id,
    assignee_level: detail.assignee_level,
    received_on: detail.received_on,
    closed_on: detail.closed_on,
    round_count: detail.round_count,
    version: detail.version,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
  };
}

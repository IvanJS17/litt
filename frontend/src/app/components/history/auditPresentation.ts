import { clientTranslator } from "@mike/client";
import type { Messages } from "@litt/i18n";
import type { AuditEvent, OrgPrivateContentKind } from "@/app/lib/mikeApi";

type Leaves<T, P extends string> = T extends string
  ? P
  : { [K in keyof T & string]: Leaves<T[K], `${P}.${K}`> }[keyof T & string];

/** Every catalog key this file reads. */
export type AuditKey = Leaves<Messages["history"]["audit"], "history.audit"> | "history.system";

/**
 * A message translator, as `useTranslations()` returns it. Text shown while
 * rendering takes the component's own `t`; a caller outside React (a test)
 * gets the configured client translator.
 */
export type AuditTranslate = (
  key: AuditKey,
  values?: Record<string, string | number | Date>,
) => string;

const clientT = (): AuditTranslate => clientTranslator() as unknown as AuditTranslate;


export interface AuditPrivateAccess {
  kind: OrgPrivateContentKind;
  item_id: string;
  has_access: boolean;
}

/** Only organization audit responses contain this server-derived descriptor. */
export function auditPrivateAccess(
  event: AuditEvent,
): AuditPrivateAccess | null {
  const value = event.detail?.private_content_access;
  if (!event.org_id || !value || typeof value !== "object") return null;
  const access = value as Record<string, unknown>;
  if (
    !["project", "workflow", "chat", "tabular_review", "document"].includes(
      String(access.kind),
    ) ||
    typeof access.item_id !== "string" ||
    !access.item_id ||
    typeof access.has_access !== "boolean"
  )
    return null;
  return access as unknown as AuditPrivateAccess;
}


const ACTION_KEYS = {
  "org.private_content.permission_changed": "privateContentPermissionChanged",
  "org.private_content.opened": "privateContentAccessed",
  "org.private_content.closed": "privateContentAccessEnded",
  "org.api_key.saved": "providerKeySaved",
  "org.api_key.removed": "providerKeyRemoved",
  "org.api_key.enabled": "providerKeyEnabled",
  "org.api_key.disabled": "providerKeyDisabled",
  "org.personal_api_keys.allowed": "personalKeysAllowed",
  "org.personal_api_keys.blocked": "personalKeysBlocked",
  "org.member_exports.allowed": "memberExportsAllowed",
  "org.member_exports.blocked": "memberExportsTurnedOff",
  "org.member_deletes.allowed": "memberDataDeletionAllowed",
  "org.member_deletes.blocked": "memberDataDeletionTurnedOff",
  "org.created": "organizationCreated",
  "org.deleted": "organizationDeleted",
  "org.restored": "organizationRestored",
  "org.purged": "organizationPermanentlyDeleted",
  "org.invite.created": "invitationSent",
  "org.invite.accepted": "invitationAccepted",
  "org.invite.declined": "invitationDeclined",
  "org.invite.cancelled": "invitationCancelled",
  "org.invite.resent": "invitationResent",
  "org.member.role_changed": "memberRoleChanged",
  "org.logo.updated": "logoUpdated",
  "org.logo.removed": "logoRemoved",
  "org.router_models.updated": "modelsUpdated",
  "org.departure.item.transferred": "departedWorkTransferred",
  "org.departure.item.archived": "departedWorkArchived",
  "org.departure.item.recovered": "departedWorkRecovered",
  "org.departure.item.deleted": "departedWorkDeleted",
  "org.departure.item.expired": "departedWorkExpired",
  "org.departure.member.departed": "memberDeparted",
  "org.departure.member.projects_succeeded": "membersMatterProjectsPassedOn",
  "org.member.removed": "memberRemoved",
  "org.member.left": "memberLeft",
  "org.data.deleted": "organizationDataDeleted",
  "chat.message": "chatMessageSent",
  "document.uploaded": "documentUploaded",
  "document.generated": "documentGenerated",
  "document.edited": "documentEdited",
  "workflow.applied": "workflowApplied",
  "tabular.created": "reviewCreated",
  "tabular.generated": "reviewRunCompleted",
  "playbook.created": "playbookCreated",
  "playbook.imported": "playbookImported",
  "playbook.replaced": "playbookReplaced",
  "playbook.deleted": "playbookDeleted",
  "playbook.run": "playbookReviewRun",
  "playbook.run.deleted": "playbookRunDeleted",
  "playbook.marked_ready": "playbookMarkedAsReady",
  "playbook.model_marked": "playbookMarkedAsModel",
  "playbook.model_unmarked": "modelMarkRemoved",
  "export.chats": "chatsExported",
  "export.account": "accountDataExported",
  "export.tabular": "reviewExported",
  "export.memory": "memoryExported",
} as const;

const OPERATION_KEYS = {
  "chat.message": "chatMessage",
  "document.uploaded": "documentUpload",
  "document.generated": "documentGeneration",
  "document.edited": "documentEdit",
  "workflow.applied": "workflowApplication",
  "tabular.created": "reviewCreation",
  "tabular.generated": "reviewRun",
  "playbook.created": "playbookCreation",
  "playbook.imported": "playbookImport",
  "playbook.replaced": "playbookReplacement",
  "playbook.deleted": "playbookDeletion",
  "playbook.run": "playbookReview",
  "playbook.run.deleted": "playbookRunDeletion",
  "export.chats": "chatExport",
  "export.account": "accountExport",
  "export.tabular": "reviewExport",
  "export.memory": "memoryExport",
} as const;

const SURFACE_KEYS = {
  assistant: "assistant",
  project: "project",
  word: "word",
  tabular: "tabular",
  playbooks: "playbooks",
  workflows: "workflows",
  account: "account",
  organization: "organization",
} as const;

/** The label of each action the audit log knows, by its recorded name. */
export function auditActionLabels(t: AuditTranslate = clientT()): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ACTION_KEYS).map(([action, key]) => [action, t(`history.audit.action.${key}`)]),
  );
}

/** The label of each application (surface) the audit log knows. */
export function auditSurfaceLabels(t: AuditTranslate = clientT()): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SURFACE_KEYS).map(([surface, key]) => [surface, t(`history.audit.surface.${key}`)]),
  );
}

export function auditSurfaceLabel(surface: string, t: AuditTranslate = clientT()): string {
  const key = SURFACE_KEYS[surface as keyof typeof SURFACE_KEYS];
  return key ? t(`history.audit.surface.${key}`) : auditLabel(surface);
}

export function auditLabel(value: string): string {
  return value
    .replace(/[_.]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const STATUS_KEYS = {
  completed: "completed",
  cancelled: "cancelled",
  failed: "failed",
} as const;

/** The label of a status the audit log records. */
export function auditStatusLabel(status: string, t: AuditTranslate = clientT()): string {
  const key = STATUS_KEYS[status as keyof typeof STATUS_KEYS];
  return key ? t(`history.audit.status.${key}`) : auditLabel(status);
}

const ROLE_KEYS = { owner: "owner", admin: "admin", member: "member" } as const;

function roleLabel(role: string, t: AuditTranslate): string {
  const key = ROLE_KEYS[role as keyof typeof ROLE_KEYS];
  return key ? t(`history.audit.role.${key}`) : auditLabel(role);
}

export function auditAction(event: AuditEvent, t: AuditTranslate = clientT()): string {
  const actionKey = ACTION_KEYS[event.action as keyof typeof ACTION_KEYS];
  const label = actionKey ? t(`history.audit.action.${actionKey}`) : auditLabel(event.action);
  // Failed or cancelled operations must not read as successful changes.
  if (event.status === "completed") return label;
  const operationKey = OPERATION_KEYS[event.action as keyof typeof OPERATION_KEYS];
  return operationKey ? t(`history.audit.operation.${operationKey}`) : label;
}

function detailText(event: AuditEvent, key: string): string | null {
  const value = event.detail?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function auditActor(event: AuditEvent, t: AuditTranslate = clientT()): string {
  if (event.user_deleted) return t("history.audit.deletedUser");
  return (
    event.user_display_name ||
    event.user_email ||
    (event.action === "org.purged" ||
    event.action === "org.departure.item.expired"
      ? t("history.system")
      : t("history.audit.unknownUser"))
  );
}

const SUBJECT_KEYS = {
  item: "item",
  recipient: "recipient",
  member: "member",
  provider: "provider",
  organization: "organization",
  document: "document",
  chat: "chat",
  workflow: "workflow",
  review: "review",
  playbookRun: "playbookRun",
  playbook: "playbook",
  chats: "chats",
  account: "account",
  memory: "memory",
  project: "project",
  tabular_review: "tabularReview",
} as const;

type SubjectCode = keyof typeof SUBJECT_KEYS;

/** The kind of thing an event acted on, as a code, not as text. */
function subjectCode(event: AuditEvent): SubjectCode | { kind: string } {
  const action = event.action;
  const kind = (): SubjectCode | { kind: string } => {
    const recorded = detailText(event, "kind") ?? "item";
    return recorded in SUBJECT_KEYS ? (recorded as SubjectCode) : { kind: recorded };
  };
  if (action.startsWith("org.invite.")) return "recipient";
  if (action === "org.private_content.permission_changed") return "member";
  if (action.startsWith("org.private_content.")) return kind();
  if (action.startsWith("org.member.") || action === "org.departure.member.departed")
    return "member";
  if (action.startsWith("org.api_key.") || action === "org.router_models.updated")
    return "provider";
  if (action.startsWith("org.departure.item.")) return kind();
  if (action.startsWith("org.")) return "organization";
  if (action.startsWith("document.")) return "document";
  if (action.startsWith("chat.")) return "chat";
  if (action.startsWith("workflow.")) return "workflow";
  if (action.startsWith("tabular.") || action === "export.tabular") return "review";
  if (action.startsWith("playbook.run")) return "playbookRun";
  if (action.startsWith("playbook.")) return "playbook";
  if (action === "export.chats") return "chats";
  if (action === "export.account") return "account";
  if (action === "export.memory") return "memory";
  return "item";
}

/** The kind of thing the event acted on, as a code that no language changes. */
export function auditSubjectKind(event: AuditEvent): string {
  const code = subjectCode(event);
  return typeof code === "string" ? code : code.kind;
}

/** Whether the event's subject is a person (a member or an invited recipient). */
export function auditSubjectIsPerson(event: AuditEvent): boolean {
  const code = subjectCode(event);
  return code === "member" || code === "recipient";
}

export function auditSubject(event: AuditEvent, t: AuditTranslate = clientT()) {
  const code = subjectCode(event);
  const type =
    typeof code === "string"
      ? t(`history.audit.subject.${SUBJECT_KEYS[code]}`)
      : auditLabel(code.kind);

  const title = event.title?.trim();
  // Some older member events stored a UUID in title. Keep identifiers in
  // technical details, not where a person's name or email is expected.
  const isId =
    title && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(title);
  const recordedName =
    title && !isId
      ? title
      : (detailText(event, "target_email") ??
        (code === "provider" ? detailText(event, "provider") : null));
  const isPerson = auditSubjectIsPerson(event);
  // An erased account is never named by an address an older row recorded.
  const name = isPerson
    ? event.affected_user_deleted
      ? t("history.audit.deletedUser")
      : event.affected_user_display_name?.trim() || recordedName
    : recordedName;
  const context = [
    detailText(event, "organization_name") ?? detailText(event, "org_name"),
    detailText(event, "project_name"),
  ].filter((value): value is string => Boolean(value));
  if (!context.length && event.surface) context.push(auditSurfaceLabel(event.surface, t));
  return {
    type,
    name: name ?? "-",
    context: [...new Set(context)].join(" · "),
  };
}

/** Retain the recorded email for identity tooltips and stable monogram colors. */
export function auditSubjectEmail(event: AuditEvent): string | null {
  if (!auditSubjectIsPerson(event)) return null;
  if (event.affected_user_deleted) return null;
  const email = (detailText(event, "target_email") ?? event.title)?.trim();
  return email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

export function auditTimestamp(value: string, exact = false, t: AuditTranslate = clientT()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("history.audit.dateUnavailable");
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(exact ? ({ second: "2-digit", timeZoneName: "short" } as const) : {}),
  });
}

export type AuditDetailField = { label: string; value: string };

export function auditDetailFields(event: AuditEvent, t: AuditTranslate = clientT()): AuditDetailField[] {
  const fields: AuditDetailField[] = [];
  const detail = event.detail ?? {};
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim())
      fields.push({ label, value });
    else if (typeof value === "number" && Number.isFinite(value))
      fields.push({ label, value: String(value) });
    else if (typeof value === "boolean")
      fields.push({ label, value: value ? t("history.audit.yes") : t("history.audit.no") });
  };
  const role = detailText(event, "role");
  const previous = detailText(event, "previous_role");
  if (event.action === "org.member.role_changed") {
    if (previous && role)
      add(
        event.status === "completed"
          ? t("history.audit.field.role")
          : t("history.audit.field.requestedRoleChange"),
        `${roleLabel(previous, t)} → ${roleLabel(role, t)}`,
      );
    else if (role) add(t("history.audit.field.role"), roleLabel(role, t));
    else if (previous) add(t("history.audit.field.previousRole"), roleLabel(previous, t));
  } else if (event.action.startsWith("org.invite.") && role)
    add(t("history.audit.field.invitedRole"), roleLabel(role, t));
  else if (previous) add(t("history.audit.field.previousRole"), roleLabel(previous, t));
  if (
    event.action.startsWith("org.departure.") ||
    event.action.startsWith("org.member.")
  ) {
    add(t("history.audit.field.itemsTransferred"), detail.transferred);
    add(t("history.audit.field.itemsArchived"), detail.archived);
  }
  if (event.action === "org.router_models.updated")
    add(t("history.audit.field.modelsAvailable"), detail.model_count);
  if (
    event.action.startsWith("org.api_key.") ||
    event.action === "org.private_content.permission_changed"
  )
    add(t("history.audit.field.enabled"), detail.enabled);
  if (event.action === "org.private_content.opened")
    add(t("history.audit.field.access"), t("history.audit.readOnly"));
  const purgeAfter = detailText(event, "purge_after");
  if (purgeAfter && !Number.isNaN(new Date(purgeAfter).getTime()))
    add(t("history.audit.field.scheduledDeletion"), auditTimestamp(purgeAfter, true, t));
  if (event.action.startsWith("export.")) {
    add(t("history.audit.field.format"), detail.format);
    add(t("history.audit.field.documentsExported"), detail.document_count);
    add(t("history.audit.field.chatsExported"), detail.chat_count);
  }
  return fields;
}

export function auditSummary(
  event: AuditEvent,
  personal: boolean,
  t: AuditTranslate = clientT(),
): string {
  const actor = personal ? t("history.audit.you") : auditActor(event, t);
  const subject = auditSubject(event, t);
  const action = auditAction(event, t);
  if (event.status !== "completed")
    return event.status === "failed"
      ? t("history.audit.summary.failed", { action })
      : event.status === "cancelled"
        ? t("history.audit.summary.cancelled", { action })
        : t("history.audit.summary.otherStatus", { action, status: event.status });
  const name =
    subject.name === "-"
      ? t("history.audit.summary.unnamed", { type: subject.type.toLowerCase() })
      : subject.name;
  if (event.action === "org.member.role_changed")
    return t("history.audit.summary.roleChanged", { actor, name });
  if (event.action === "org.invite.created")
    return t("history.audit.summary.invited", { actor, name });
  if (event.action === "org.invite.resent")
    return t("history.audit.summary.resentInvitation", { actor, name });
  if (event.action === "document.uploaded")
    return t("history.audit.summary.uploaded", { actor, name });
  if (event.action === "document.edited")
    return t("history.audit.summary.edited", { actor, name });
  if (event.action === "document.generated")
    return t("history.audit.summary.generated", { actor, name });
  return personal
    ? t("history.audit.summary.byYou", { action })
    : t("history.audit.summary.byActor", { action, actor });
}

export function auditDestination(
  event: AuditEvent,
  t: AuditTranslate = clientT(),
): { href: string; label: string } | null {
  if (event.review_id)
    return {
      href: `/tabular-reviews/${encodeURIComponent(event.review_id)}`,
      label: t("history.audit.openReview"),
    };
  if (event.chat_id && event.surface !== "word")
    return {
      href: event.project_id
        ? `/projects/${encodeURIComponent(event.project_id)}/assistant/chat/${encodeURIComponent(event.chat_id)}`
        : `/assistant/chat/${encodeURIComponent(event.chat_id)}`,
      label: t("history.audit.openChat"),
    };
  if (event.project_id)
    return {
      href: `/projects/${encodeURIComponent(event.project_id)}`,
      label: t("history.audit.openProject"),
    };
  const access = auditPrivateAccess(event);
  if (access && ["project", "chat", "tabular_review"].includes(access.kind)) {
    const target = {
      project: { path: "/projects/", label: t("history.audit.openProject") },
      chat: { path: "/assistant/chat/", label: t("history.audit.openChat") },
      tabular_review: { path: "/tabular-reviews/", label: t("history.audit.openReview") },
    }[access.kind as "project" | "chat" | "tabular_review"];
    return {
      href: `${target.path}${encodeURIComponent(access.item_id)}`,
      label: target.label,
    };
  }
  return null;
}

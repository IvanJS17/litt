"use client";

import type { ConnectorApprovalItem } from "@mike/contracts";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AppTranslate } from "@/i18n/Translate";

// Readable labels for the argument names Mike's built-in connectors use.
// Anything else (for example an MCP server's own parameters) shows its key.
const LABEL_KEYS = {
  to: "shared.connectorActionCard.argTo",
  cc: "shared.connectorActionCard.argCc",
  bcc: "shared.connectorActionCard.argBcc",
  subject: "shared.connectorActionCard.argSubject",
  body: "shared.connectorActionCard.argMessage",
  calendar_id: "shared.connectorActionCard.argCalendar",
  event_id: "shared.connectorActionCard.argEvent",
  file_id: "shared.connectorActionCard.argFile",
  parent_id: "shared.connectorActionCard.argDestinationFolder",
  file_type: "shared.connectorActionCard.argFileType",
  content: "shared.connectorActionCard.argNewContents",
  file: "shared.connectorActionCard.argFile",
  destination: "shared.connectorActionCard.argDestinationFolder",
  name: "shared.connectorActionCard.argName",
  draft_id: "shared.connectorActionCard.argDraft",
  message_id: "shared.connectorActionCard.argMessage",
  summary: "shared.connectorActionCard.argTitle",
  description: "shared.connectorActionCard.argDescription",
  location: "shared.connectorActionCard.argLocation",
  start: "shared.connectorActionCard.argStart",
  end: "shared.connectorActionCard.argEndExclusiveForAll",
  attendees: "shared.connectorActionCard.argAttendees",
  add_label_ids: "shared.connectorActionCard.argAddLabels",
  remove_label_ids: "shared.connectorActionCard.argRemoveLabels",
  date: "shared.connectorActionCard.argDate",
  dateTime: "shared.connectorActionCard.argDateAndTime",
  timeZone: "shared.connectorActionCard.argTimeZone",
  email: "shared.connectorActionCard.argEmail",
} as const;

function argumentLabel(t: AppTranslate, key: string): string {
  return Object.hasOwn(LABEL_KEYS, key)
    ? t(LABEL_KEYS[key as keyof typeof LABEL_KEYS])
    : key;
}

function display(t: AppTranslate, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => display(t, item)).join("\n");
  if (value && typeof value === "object")
    return Object.entries(value)
      .filter(([, nested]) => nested !== undefined && nested !== null)
      .map(([key, nested]) => `${argumentLabel(t, key)}: ${display(t, nested)}`)
      .join("\n");
  return String(value ?? "");
}

function consequenceNote(t: AppTranslate, item: ConnectorApprovalItem): string | null {
  if (item.tool_name === "google_drive_replace_file_content")
    return t("shared.connectorActionCard.replacesFileContents");
  if (item.tool_name === "google_drive_trash_file")
    return t("shared.connectorActionCard.movesToTrash");
  if (item.tool_name === "google_drive_move_file")
    return t("shared.connectorActionCard.movingMayChangeAccess");
  if (
    item.binding.type === "google" &&
    item.binding.provider === "google-calendar"
  )
    return t("shared.connectorActionCard.googleNotifiesAttendees");
  if (item.tool_name === "gmail_delete_draft")
    return t("shared.connectorActionCard.deletesTheDraft");
  return null;
}

/**
 * The exact connector action waiting for approval: what runs, where, and as
 * whom. It renders for Google and MCP connectors alike; decisions are made by
 * the surface around it.
 */
export function ConnectorActionCard({ item }: { item: ConnectorApprovalItem }) {
  const t = useTranslations();
  const note = consequenceNote(t, item);
  const args = Object.entries(item.arguments).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  return (
    <article
      aria-label={t("shared.connectorActionCard.titleOnConnectorName", { title: item.title, connector_name: item.connector_name })}
      className="space-y-3 text-left"
    >
      <div>
        <h4 className="text-sm font-medium text-gray-900">{item.title}</h4>
        <p className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]">
          {item.connector_name}
          {item.account ? ` · ${item.account}` : ""}
        </p>
        {item.requested_by && (
          <p className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]">
            {t("shared.connectorActionCard.requestedBySubagentRequestedBy", { requested_by: item.requested_by })}
          </p>
        )}
      </div>
      {note && <p className="text-sm text-gray-700">{note}</p>}
      {args.length > 0 ? (
        <dl className="space-y-2 text-sm">
          {args.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs text-gray-500">{argumentLabel(t, key)}</dt>
              <dd className="whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere]">
                {display(t, value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-gray-500">{t("shared.connectorActionCard.thisActionTakesNoDetails")}</p>
      )}
      {item.before !== undefined && (
        <details className="group/approval-details">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-3 shrink-0 group-open/approval-details:rotate-90"
            />
            {t("shared.connectorActionCard.currentItemBeforeThisChange")}
          </summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-sans text-xs text-gray-700 [overflow-wrap:anywhere]">
            {display(t, item.before)}
          </pre>
        </details>
      )}
    </article>
  );
}

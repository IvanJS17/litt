"use client";

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type { ProfileFact, ProfileFactEvent } from "@mike/contracts";
import { FormTextInput } from "@/app/components/ui/form-field";
import { FIELDS, fieldWord, REASON_MAX } from "./profileOptions";

/** The fields a fact states, as label and value pairs in the order of the form. */
function useFactRows(fact: ProfileFact): [string, string][] {
  const t = useTranslations();
  const format = useFormatter();
  const day = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const data = fact.data;
  const rows: [string, string | undefined][] =
    fact.kind === "date"
      ? [
          [t("clientProfile.fields.dateKind"), data.date_kind ? t(`clientProfile.dateKind.${data.date_kind}`) : undefined],
          [t("clientProfile.fields.dateOn"), data.date_on ? day(data.date_on) : undefined],
          [t("clientProfile.fields.ruleText"), data.rule_text],
          [
            t("clientProfile.fields.noticeDays"),
            data.notice_days === undefined
              ? undefined
              : t("clientProfile.noticeSummary", {
                  days: data.notice_days,
                  type: t(`clientProfile.dayType.${data.notice_day_type ?? "calendar"}`),
                }),
          ],
        ]
      : FIELDS[fact.kind].map((field): [string, string | undefined] => {
          const value = (data as Record<string, string | undefined>)[field.key];
          return [t(`clientProfile.fields.${fieldWord(field.key)}`), field.kind === "date" && value ? day(value) : value];
        });
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

/**
 * One fact of the profile: what it says, the passage that backs it, where that
 * passage lives and what the team did with it. The status is plain text; a
 * fact whose source changed says so and cannot be confirmed until it is
 * captured again from the current text.
 */
export function ProfileFactCard({
  fact,
  names,
  canWrite,
  busy,
  onConfirm,
  onReject,
}: {
  fact: ProfileFact;
  /** User id → name, for the people the profile names. */
  names: ReadonlyMap<string, string | null>;
  canWrite: boolean;
  busy: boolean;
  onConfirm: () => void;
  onReject: (reason: string) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const rows = useFactRows(fact);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const person = (userId: string | null) =>
    (userId ? names.get(userId) : null) ?? t("clientProfile.history.unknownPerson");
  const when = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const line = (event: ProfileFactEvent) =>
    [
      t(`clientProfile.history.${event.action}`, { name: person(event.actor_user_id), date: when(event.created_at) }),
      event.reason ? t("clientProfile.history.reason", { reason: event.reason }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const open = fact.status !== "rejected";
  const tone =
    fact.effective_status === "stale"
      ? "text-amber-800"
      : fact.effective_status === "confirmed"
        ? "text-green-800"
        : fact.effective_status === "rejected"
          ? "text-gray-500"
          : "text-gray-700";
  const source = fact.source;

  return (
    <article aria-labelledby={`${id}-label`} className="min-w-0 space-y-3 rounded-xl bg-app-surface/60 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`${id}-label`} className="min-w-0 break-words text-sm font-medium text-gray-900">
          {fact.label}
        </h3>
        <p className={`text-xs font-medium ${tone}`}>{t(`clientProfile.status.${fact.effective_status}`)}</p>
      </header>
      {fact.stale_reason ? (
        <p className="text-xs text-amber-800">{t(`clientProfile.stale.${fact.stale_reason}`)}</p>
      ) : null}
      {rows.length > 0 ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
          {rows.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-gray-500">{name}</dt>
              <dd className="min-w-0 break-words text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <figure className="space-y-1 border-l-2 border-gray-300 pl-3">
        <figcaption className="text-xs text-gray-500">
          {t("clientProfile.source.label")}
          {": "}
          {source.version_number === null && source.filename === null
            ? t("clientProfile.source.gone")
            : t("clientProfile.source.file", {
                name: source.filename ?? source.document_id,
                version: source.version_number ?? "–",
              })}
        </figcaption>
        <blockquote className="break-words whitespace-pre-wrap text-sm text-gray-700" aria-label={t("clientProfile.source.quote")}>
          {source.quote}
        </blockquote>
      </figure>
      <ol className="space-y-0.5">
        {fact.events.map((event) => (
          <li key={event.id} className="break-words text-xs text-gray-500">
            {line(event)}
          </li>
        ))}
      </ol>
      {canWrite && open ? (
        <div className="space-y-2">
          {fact.status === "pending" && fact.stale_reason ? (
            <p className="text-xs text-gray-600">{t("clientProfile.actions.staleHint")}</p>
          ) : null}
          {rejecting ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-gray-900">
                {t("clientProfile.actions.reasonLabel")}
              </label>
              <FormTextInput
                id={`${id}-reason`}
                value={reason}
                maxLength={REASON_MAX}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {rejecting ? (
              <TextButtonUI
                type="button"
                size="sm"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
              >
                {t("clientProfile.actions.cancel")}
              </TextButtonUI>
            ) : null}
            <PillButtonUI
              type="button"
              tone="white"
              size="sm"
              className="pointer-coarse:min-h-11"
              disabled={busy}
              aria-busy={busy && rejecting}
              onClick={() => (rejecting ? onReject(reason.trim()) : setRejecting(true))}
            >
              {busy && rejecting
                ? t("clientProfile.actions.rejecting")
                : rejecting
                  ? t("clientProfile.actions.rejectConfirm")
                  : t("clientProfile.actions.reject")}
            </PillButtonUI>
            {fact.status === "pending" && !rejecting ? (
              <PillButtonUI
                type="button"
                tone="black"
                size="sm"
                className="pointer-coarse:min-h-11"
                disabled={busy || fact.stale_reason !== null}
                aria-busy={busy}
                onClick={onConfirm}
              >
                {busy ? t("clientProfile.actions.confirming") : t("clientProfile.actions.confirm")}
              </PillButtonUI>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type { RadarAction, RadarItem } from "@mike/contracts";
import { FormTextInput } from "@/app/components/ui/form-field";
import { REASON_MAX } from "./radarOptions";
import { useRadarWords } from "./radarText";

const ACTION_OF_STATE = { acknowledged: "ack", dismissed: "dismiss", done: "done" } as const;

/**
 * One item of the radar: what is due and when (computed by the server, in
 * calendar days), the fact it comes from with the passage that backs it, and
 * what the team did with it. States are plain text. An item with no date says
 * why (a business-day notice, or nothing to count from) instead of guessing one.
 */
export function RadarItemCard({
  item,
  names,
  canWrite,
  busy,
  profileHref,
  onAct,
}: {
  item: RadarItem;
  /** User id → name, for the people the radar names. */
  names: ReadonlyMap<string, string | null>;
  canWrite: boolean;
  busy: boolean;
  /** Where the fact lives, when the page has a place to send the reader. */
  profileHref?: string;
  onAct: (action: RadarAction, reason: string) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const { day, distance } = useRadarWords();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [missingReason, setMissingReason] = useState(false);
  const alive = item.state === "open" || item.state === "acknowledged";
  const source = item.source;
  const when = distance(item);
  const tone =
    item.bucket === "overdue"
      ? "text-red-700"
      : item.bucket === "review"
        ? "text-amber-800"
        : "text-gray-700";
  const history =
    item.state === "open" || !item.acted_at
      ? null
      : [
          t(`radar.history.${ACTION_OF_STATE[item.state]}`, {
            name: (item.acted_by ? names.get(item.acted_by) : null) ?? t("radar.history.unknownPerson"),
            date: format.dateTime(new Date(item.acted_at), { dateStyle: "medium", timeStyle: "short" }),
          }),
          item.reason ? t("radar.history.reason", { reason: item.reason }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  function dismiss() {
    if (!reason.trim()) {
      setMissingReason(true);
      return;
    }
    onAct("dismiss", reason.trim());
  }

  return (
    <article aria-labelledby={`${id}-label`} className="min-w-0 space-y-3 rounded-xl bg-app-surface/60 p-4">
      <header className="space-y-1">
        <p className="text-xs text-gray-500">{t(`radar.type.${item.type}`)}</p>
        <h3 id={`${id}-label`} className="min-w-0 break-words text-sm font-medium text-gray-900">
          {item.label}
        </h3>
        {item.due_on ? (
          <p className={`text-sm font-medium ${tone}`}>
            {t("radar.when.onDate", { date: day(item.due_on) })}
            {when ? <span className="font-normal"> · {when}</span> : null}
          </p>
        ) : null}
        <p className="text-xs text-gray-500">{t(`radar.state.${item.state}`)}</p>
      </header>
      {item.review_reason ? <p className="text-sm text-amber-800">{t(`radar.review.${item.review_reason}`)}</p> : null}
      <div className="space-y-1 text-xs text-gray-600">
        {item.base_on && item.notice_days !== null && item.due_on ? (
          <p>{t("radar.basis", { date: day(item.base_on), days: item.notice_days })}</p>
        ) : null}
        {item.review_reason && item.notice_days !== null ? (
          <p>
            {t(item.review_reason === "business_days" ? "radar.noticeBusinessDays" : "radar.noticeDays", {
              days: item.notice_days,
            })}
          </p>
        ) : null}
        {item.rule_text ? <p className="break-words">{t("radar.rule", { rule: item.rule_text })}</p> : null}
      </div>
      <figure className="space-y-1 border-l-2 border-gray-300 pl-3">
        <figcaption className="text-xs text-gray-500">
          {t("radar.source.label")}
          {": "}
          {source.version_number === null && source.filename === null
            ? t("radar.source.gone")
            : t("radar.source.file", { name: source.filename ?? source.document_id, version: source.version_number ?? "–" })}
        </figcaption>
        <blockquote className="break-words whitespace-pre-wrap text-sm text-gray-700" aria-label={t("radar.source.quote")}>
          {source.quote}
        </blockquote>
      </figure>
      {profileHref ? (
        <Link
          href={profileHref}
          className="inline-block rounded text-xs text-gray-500 underline hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("radar.source.profile")}
        </Link>
      ) : null}
      {history ? <p className="break-words text-xs text-gray-500">{history}</p> : null}
      {canWrite && alive ? (
        <div className="space-y-2">
          {dismissing ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-gray-900">
                {t("radar.actions.reasonLabel")}
              </label>
              <FormTextInput
                id={`${id}-reason`}
                value={reason}
                maxLength={REASON_MAX}
                disabled={busy}
                aria-invalid={missingReason || undefined}
                aria-describedby={missingReason ? `${id}-reason-error` : undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  setMissingReason(false);
                }}
              />
              {missingReason ? (
                <p id={`${id}-reason-error`} role="alert" className="text-xs text-red-700">
                  {t("radar.actions.reasonRequired")}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {dismissing ? (
              <TextButtonUI
                type="button"
                size="sm"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                onClick={() => {
                  setDismissing(false);
                  setReason("");
                  setMissingReason(false);
                }}
              >
                {t("radar.actions.cancel")}
              </TextButtonUI>
            ) : null}
            <PillButtonUI
              type="button"
              tone="white"
              size="sm"
              className="pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => (dismissing ? dismiss() : setDismissing(true))}
            >
              {busy && dismissing ? t("radar.actions.dismissing") : dismissing ? t("radar.actions.dismissConfirm") : t("radar.actions.dismiss")}
            </PillButtonUI>
            {!dismissing && item.state === "open" ? (
              <PillButtonUI
                type="button"
                tone="white"
                size="sm"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                onClick={() => onAct("ack", "")}
              >
                {t("radar.actions.ack")}
              </PillButtonUI>
            ) : null}
            {!dismissing ? (
              <PillButtonUI
                type="button"
                tone="black"
                size="sm"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                aria-busy={busy}
                onClick={() => onAct("done", "")}
              >
                {busy ? t("radar.actions.doing") : t("radar.actions.done")}
              </PillButtonUI>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

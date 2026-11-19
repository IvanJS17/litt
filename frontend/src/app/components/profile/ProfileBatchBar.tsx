"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import { FormTextInput } from "@/app/components/ui/form-field";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { REASON_MAX } from "./profileOptions";

/** The last batch's outcome, kept by the page so it outlives the list it emptied. */
export type BatchSummary = { action: "confirm" | "reject"; ok: number; failed: number };

/** The checkbox of one proposal; its name is the fact's own label. */
export function ProposalCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations();
  return (
    <input
      type="checkbox"
      className={`${TABLE_CHECKBOX_CLASS} mt-5`}
      aria-label={t("clientProfile.batch.selectFact", { name: label })}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/**
 * Review of the proposals in bulk: select all, confirm or reject the selected
 * ones. Rejecting asks for the optional reason first, as a single rejection
 * does; one reason goes with every fact. The result is a live summary.
 */
export function ProfileBatchBar({
  total,
  selected,
  busy,
  onSelectAll,
  onDecide,
}: {
  total: number;
  selected: number;
  busy: boolean;
  onSelectAll: (checked: boolean) => void;
  onDecide: (action: "confirm" | "reject", reason: string) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const none = selected === 0;
  const stop = () => {
    setRejecting(false);
    setReason("");
  };
  return (
    <div role="group" aria-label={t("clientProfile.batch.group")} className="space-y-2 rounded-xl bg-app-surface/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="flex items-center text-sm text-gray-900">
          <input
            type="checkbox"
            className={TABLE_CHECKBOX_CLASS}
            checked={selected === total && total > 0}
            ref={(node) => {
              if (node) node.indeterminate = selected > 0 && selected < total;
            }}
            disabled={busy}
            onChange={(event) => onSelectAll(event.target.checked)}
          />
          {t("clientProfile.batch.selectAll")}
        </label>
        <p className="text-xs text-gray-600" aria-live="polite">
          {t("clientProfile.batch.selected", { count: selected })}
        </p>
      </div>
      {rejecting ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-gray-900">
            {t("clientProfile.batch.reasonLabel")}
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
          <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={busy} onClick={stop}>
            {t("clientProfile.actions.cancel")}
          </TextButtonUI>
        ) : null}
        <PillButtonUI
          type="button"
          tone="white"
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={busy || none}
          aria-busy={busy && rejecting}
          onClick={() => {
            if (!rejecting) return setRejecting(true);
            onDecide("reject", reason.trim());
            stop();
          }}
        >
          {busy && rejecting
            ? t("clientProfile.batch.rejecting")
            : rejecting
              ? t("clientProfile.batch.rejectConfirm", { count: selected })
              : t("clientProfile.batch.reject")}
        </PillButtonUI>
        {!rejecting ? (
          <PillButtonUI
            type="button"
            tone="black"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy || none}
            aria-busy={busy}
            onClick={() => onDecide("confirm", "")}
          >
            {busy ? t("clientProfile.batch.confirming") : t("clientProfile.batch.confirm")}
          </PillButtonUI>
        ) : null}
      </div>
    </div>
  );
}

/** What the last batch did, announced politely; failures say what to do. */
export function BatchResult({ summary }: { summary: BatchSummary | null }) {
  const t = useTranslations();
  return (
    <div role="status" aria-live="polite" className="space-y-0.5 text-sm text-gray-900">
      {summary ? (
        <>
          {summary.ok > 0 ? (
            <p>{t(summary.action === "confirm" ? "clientProfile.batch.doneConfirmed" : "clientProfile.batch.doneRejected", { count: summary.ok })}</p>
          ) : null}
          {summary.failed > 0 ? <p className="text-amber-800">{t("clientProfile.batch.failed", { count: summary.failed })}</p> : null}
        </>
      ) : null}
    </div>
  );
}

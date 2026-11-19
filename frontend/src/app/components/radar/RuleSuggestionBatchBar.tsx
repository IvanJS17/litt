"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import { FormTextInput } from "@/app/components/ui/form-field";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";

export const SUGGESTION_REASON_MAX = 500;

/** The last batch's outcome, kept by the panel so it outlives the list it emptied. */
export type SuggestionBatchSummary = { action: "accept" | "discard"; ok: number; failed: number };

/** The checkbox of one suggestion; its name is the rule's own name. */
export function SuggestionCheckbox({
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
      className={`${TABLE_CHECKBOX_CLASS} mt-1`}
      aria-label={t("radar.rules.suggest.batch.selectOne", { name: label })}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/**
 * Review of the suggestions in bulk: select all, accept or discard the selected
 * ones. Discarding asks for the optional reason first, as a single discard does;
 * one reason goes with every suggestion. Accepting turns no rule on.
 */
export function RuleSuggestionBatchBar({
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
  onDecide: (action: "accept" | "discard", reason: string) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState("");
  const none = selected === 0;
  const stop = () => {
    setDiscarding(false);
    setReason("");
  };
  return (
    <div role="group" aria-label={t("radar.rules.suggest.batch.group")} className="space-y-2 rounded-xl bg-app-surface/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-900">
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
          {t("radar.rules.suggest.batch.selectAll")}
        </label>
        <p className="text-xs text-gray-600" aria-live="polite">
          {t("radar.rules.suggest.batch.selected", { count: selected })}
        </p>
      </div>
      {discarding ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-gray-900">
            {t("radar.rules.suggest.batch.reasonLabel")}
          </label>
          <FormTextInput
            id={`${id}-reason`}
            value={reason}
            maxLength={SUGGESTION_REASON_MAX}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {discarding ? (
          <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={busy} onClick={stop}>
            {t("radar.rules.suggest.cancel")}
          </TextButtonUI>
        ) : null}
        <PillButtonUI
          type="button"
          tone="white"
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={busy || none}
          aria-busy={busy && discarding}
          onClick={() => {
            if (!discarding) return setDiscarding(true);
            onDecide("discard", reason.trim());
            stop();
          }}
        >
          {busy && discarding
            ? t("radar.rules.suggest.batch.discarding")
            : discarding
              ? t("radar.rules.suggest.batch.discardConfirm", { count: selected })
              : t("radar.rules.suggest.batch.discard")}
        </PillButtonUI>
        {!discarding ? (
          <PillButtonUI
            type="button"
            tone="black"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy || none}
            aria-busy={busy}
            onClick={() => onDecide("accept", "")}
          >
            {busy ? t("radar.rules.suggest.batch.accepting") : t("radar.rules.suggest.batch.accept")}
          </PillButtonUI>
        ) : null}
      </div>
    </div>
  );
}

/** What the last batch did, announced politely; failures say what to do. */
export function SuggestionBatchResult({ summary }: { summary: SuggestionBatchSummary | null }) {
  const t = useTranslations();
  return (
    <div role="status" aria-live="polite" className="space-y-0.5 text-sm text-gray-900">
      {summary ? (
        <>
          {summary.ok > 0 ? (
            <p>
              {t(summary.action === "accept" ? "radar.rules.suggest.batch.doneAccepted" : "radar.rules.suggest.batch.doneDiscarded", {
                count: summary.ok,
              })}
            </p>
          ) : null}
          {summary.failed > 0 ? <p className="text-amber-800">{t("radar.rules.suggest.batch.failed", { count: summary.failed })}</p> : null}
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { FieldLabel, FormTextInput, FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { PRACTICE_OPTIONS } from "@/app/components/workflows/practices";
import type { FirmCriterion, FirmCriterionInput, FirmCriterionKind, Playbook } from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { usePracticeOptionLabel } from "../trainingShared";

// Writing or changing one criterion (docs/training.md, "One mold of
// criterion"). The server checks everything again; this form only keeps the
// obvious mistakes out and says what each field is for.

export const TOPIC_MAX = 120;
export const POSITION_MAX = 2000;
const KINDS: readonly FirmCriterionKind[] = ["criterio", "voto_particular"];
const ANY_PRACTICE = "";
const SELECT_CLASS = cn("h-10", FORM_CONTROL_GLASS_CLASS);

/** The stored (normalized) practice area, as the option it came from. */
function optionFor(practice: string | null): string {
  if (!practice) return ANY_PRACTICE;
  const found = (PRACTICE_OPTIONS as readonly string[]).find(
    (option) => option.trim().toLowerCase() === practice,
  );
  return found ?? practice;
}

export function FirmCriterionForm({
  existing,
  playbooks,
  busy,
  onSave,
  onCancel,
}: {
  existing: FirmCriterion | null;
  /** Playbooks of the organization the person can open; null while they load. */
  playbooks: Playbook[] | null;
  busy: boolean;
  onSave: (input: FirmCriterionInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("training.firmCriteria.settings");
  const practiceLabel = usePracticeOptionLabel();
  const id = useId();
  const [kind, setKind] = useState<FirmCriterionKind>(existing?.kind ?? "criterio");
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [practice, setPractice] = useState(optionFor(existing?.practice ?? null));
  const [position, setPosition] = useState(existing?.position ?? "");
  const [playbookId, setPlaybookId] = useState(existing?.playbook_id ?? "");
  const [ruleId, setRuleId] = useState(existing?.rule_id ?? "");

  const playbook = playbooks?.find((candidate) => candidate.id === playbookId) ?? null;
  const rules = (playbook?.content.topics ?? []).flatMap((topicGroup) => topicGroup.rules);
  useEffect(() => {
    // A rule of another playbook is not a rule of this one.
    if (ruleId && playbook && !rules.some((rule) => rule.id === ruleId)) setRuleId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the playbook changes
  }, [playbookId]);

  const vote = kind === "voto_particular";
  const complete =
    topic.trim().length > 0 &&
    position.trim().length > 0 &&
    (!vote || (playbookId !== "" && ruleId !== ""));

  const submit = () =>
    onSave({
      kind,
      topic: topic.trim(),
      position: position.trim(),
      practice: practice === ANY_PRACTICE ? null : practice,
      ...(vote ? { playbook_id: playbookId, rule_id: ruleId } : {}),
    });

  return (
    <form
      className="min-w-0 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !busy) submit();
      }}
    >
      <fieldset className="min-w-0" disabled={busy}>
        <legend className="mb-2 text-sm font-medium text-gray-700">{t("kindLabel")}</legend>
        <div className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
          {KINDS.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name={`${id}-kind`}
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="h-4 w-4 accent-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
              />
              {value === "criterio" ? t("kind.criterio") : t("kind.voto_particular")}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="min-w-0">
        <FieldLabel htmlFor={`${id}-topic`}>{t("topicLabel")}</FieldLabel>
        <FormTextInput
          id={`${id}-topic`}
          value={topic}
          maxLength={TOPIC_MAX}
          disabled={busy}
          aria-describedby={`${id}-topic-help`}
          onChange={(event) => setTopic(event.target.value)}
        />
        <p id={`${id}-topic-help`} className="mt-1 text-xs text-gray-500">{t("topicHelp")}</p>
      </div>

      <div className="min-w-0">
        <FieldLabel htmlFor={`${id}-practice`}>{t("practiceLabel")}</FieldLabel>
        <select
          id={`${id}-practice`}
          value={practice}
          disabled={busy}
          onChange={(event) => setPractice(event.target.value)}
          className={SELECT_CLASS}
        >
          <option value={ANY_PRACTICE}>{t("practiceAny")}</option>
          {practice !== ANY_PRACTICE && !(PRACTICE_OPTIONS as readonly string[]).includes(practice) && (
            <option value={practice}>{practiceLabel(practice.trim().toLowerCase())}</option>
          )}
          {PRACTICE_OPTIONS.map((option) => (
            <option key={option} value={option}>{practiceLabel(option.trim().toLowerCase())}</option>
          ))}
        </select>
      </div>

      {vote && (
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-gray-500">{t("voteHelp")}</p>
          {playbooks !== null && playbooks.length === 0 ? (
            <p role="status" className="text-sm text-gray-700">{t("noPlaybooks")}</p>
          ) : (
            <>
              <div className="min-w-0">
                <FieldLabel htmlFor={`${id}-playbook`}>{t("playbookLabel")}</FieldLabel>
                <select
                  id={`${id}-playbook`}
                  value={playbookId}
                  disabled={busy || playbooks === null}
                  onChange={(event) => setPlaybookId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("playbookPlaceholder")}</option>
                  {(playbooks ?? []).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <FieldLabel htmlFor={`${id}-rule`}>{t("ruleLabel")}</FieldLabel>
                <select
                  id={`${id}-rule`}
                  value={ruleId}
                  disabled={busy || !playbook}
                  onChange={(event) => setRuleId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("rulePlaceholder")}</option>
                  {rules.map((rule) => (
                    <option key={rule.id} value={rule.id}>{rule.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      )}

      <div className="min-w-0">
        <FieldLabel htmlFor={`${id}-position`}>{t("positionLabel")}</FieldLabel>
        <textarea
          id={`${id}-position`}
          value={position}
          maxLength={POSITION_MAX}
          disabled={busy}
          aria-describedby={`${id}-position-help ${id}-position-count`}
          onChange={(event) => setPosition(event.target.value)}
          className="min-h-40 w-full rounded-xl border border-gray-200 bg-surface-field px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60"
        />
        <p id={`${id}-position-help`} className="mt-1 text-xs text-gray-500">{t("positionHelp")}</p>
        <p id={`${id}-position-count`} className="text-xs text-gray-500">
          {t("positionCount", { count: [...position].length, max: POSITION_MAX })}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <PillButtonUI type="submit" tone="black" size="sm" disabled={busy || !complete} loading={busy}>
          {busy ? t("saving") : t("save")}
        </PillButtonUI>
        <PillButtonUI type="button" tone="white" size="sm" disabled={busy} onClick={onCancel}>
          {t("cancel")}
        </PillButtonUI>
      </div>
    </form>
  );
}

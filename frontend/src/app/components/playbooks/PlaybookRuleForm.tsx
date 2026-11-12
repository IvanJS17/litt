"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { HeaderActionsMenu } from "@/app/components/shared/HeaderActionsMenu";
import { LIQUID_GLASS_FLAT_CLASS } from "@/app/components/ui/liquid-surface";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import {
  PlaybookField as Field,
  PLAYBOOK_HELP_CLASS,
  PLAYBOOK_LABEL_CLASS,
  PLAYBOOK_TEXTAREA_CLASS,
} from "./PlaybookField";
import type {
  PlaybookClause,
  PlaybookClauseUsage,
  PlaybookPosition,
  PlaybookRule,
} from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { PlaybookRuleOrigin } from "./PlaybookRuleOrigin";
import { NO_PROVENANCE, type PlaybookProvenance } from "./usePlaybookProvenance";
import { useTranslations } from "next-intl";
import type { NsTranslate } from "@/i18n/Translate";

type PositionKind = "standard" | "fallbacks" | "unacceptable";
type RuleAction = PlaybookRule["actions"][number];

/**
 * Applies a change that discards text, and offers to reverse it. `undo`
 * receives the rule as it is when Undo is pressed, not as it was removed.
 */
export type UndoableRuleChange = (
  next: PlaybookRule,
  message: string,
  undo: (latest: PlaybookRule) => PlaybookRule,
) => void;

const POSITION_GROUPS: Record<
  PositionKind,
  {
    /** Matches the review's acceptable, needs-review and unacceptable colors. */
    dot: string;
    usage: PlaybookClauseUsage;
  }
> = {
  standard: { dot: "bg-emerald-500", usage: "preferred" },
  fallbacks: { dot: "bg-warning-fill", usage: "illustrative" },
  unacceptable: { dot: "bg-red-500", usage: "unacceptable" },
};

type PlaybooksTranslate = NsTranslate<"playbooks">;

/** The heading, the name of one position and the empty note of a group. */
function positionText(kind: PositionKind, t: PlaybooksTranslate) {
  switch (kind) {
    case "standard":
      return {
        title: t("playbooks.standardPosition"),
        label: t("playbooks.standard"),
        empty: t("playbooks.noneYet"),
      };
    case "fallbacks":
      return {
        title: t("playbooks.fallbackPositions"),
        label: t("playbooks.fallback"),
        empty: t("playbooks.noneYet"),
      };
    default:
      return {
        title: t("playbooks.unacceptablePositions"),
        label: t("playbooks.unacceptable"),
        empty: t("playbooks.noneYet"),
      };
  }
}

function usageOptions(t: PlaybooksTranslate): { value: PlaybookClauseUsage; label: string }[] {
  return [
    { value: "illustrative", label: t("playbooks.illustrative") },
    { value: "preferred", label: t("playbooks.preferred") },
    { value: "verbatim", label: t("playbooks.verbatim") },
    { value: "accepted", label: t("playbooks.previouslyAccepted") },
    { value: "unacceptable", label: t("playbooks.unacceptable") },
  ];
}

// A sample clause is one grey tile: its controls along the top and the clause
// text below, with the focus ring on the whole tile rather than the text box.
const CLAUSE_TILE_CLASS =
  "min-w-0 rounded-lg bg-gray-100 transition-shadow focus-within:ring-2 focus-within:ring-gray-300/45";

function positionsOf(rule: PlaybookRule, kind: PositionKind) {
  if (kind !== "standard") return rule[kind];
  return rule.standard ? [rule.standard] : [];
}

function withPositions(
  rule: PlaybookRule,
  kind: PositionKind,
  positions: PlaybookPosition[],
): PlaybookRule {
  return kind === "standard"
    ? { ...rule, standard: positions[0] ?? null }
    : { ...rule, [kind]: positions };
}

function insertAt<T>(items: T[], index: number, item: T) {
  const next = [...items];
  next.splice(Math.min(index, next.length), 0, item);
  return next;
}

function positionLabel(kind: PositionKind, index: number, t: PlaybooksTranslate) {
  const { label } = positionText(kind, t);
  return kind === "standard" ? label : `${label} ${index + 1}`;
}

/** A clause whose usage contradicts the position it illustrates. */
export function clauseUsageConflict(
  kind: PositionKind,
  usage: PlaybookClauseUsage,
) {
  if (kind === "unacceptable")
    return usage === "illustrative" || usage === "unacceptable"
      ? null
      : "unacceptable";
  return usage === "unacceptable" ? "acceptable" : null;
}

/** Source markers such as P4 or T2R3C1, written out for people. */
export function describeSourceRefs(refs: string[], t: PlaybooksTranslate) {
  return refs
    .map((ref) => {
      const paragraph = /^P(\d+)$/.exec(ref);
      if (paragraph) return t("playbooks.sourceParagraph", { n: paragraph[1] });
      const cell = /^T(\d+)R(\d+)C(\d+)$/.exec(ref);
      if (cell) return t("playbooks.sourceTableCell", { table: cell[1], row: cell[2], cell: cell[3] });
      return ref;
    })
    .join("; ");
}

export type RuleFormTab = "details" | "positions" | "escalation";

export function ruleFormTabs(t: PlaybooksTranslate): { id: RuleFormTab; label: string }[] {
  return [
    { id: "details", label: t("playbooks.overview") },
    { id: "positions", label: t("playbooks.positions") },
    { id: "escalation", label: t("playbooks.escalation") },
  ];
}

export function PlaybookRuleForm({
  tab,
  rule,
  onChange,
  onUndoableChange,
  provenance = NO_PROVENANCE,
}: {
  tab: RuleFormTab;
  rule: PlaybookRule;
  onChange: (rule: PlaybookRule) => void;
  onUndoableChange: UndoableRuleChange;
  /** LiTT: document names and answers a drafted rule's origin shows. */
  provenance?: PlaybookProvenance;
}) {
  const t = useTranslations();
  const scopeId = useId();
  const requiredId = useId();
  if (tab === "positions")
    return (
      <div className="space-y-4">
        {(["standard", "fallbacks", "unacceptable"] as const).map((kind) => (
          <PositionGroup
            key={kind}
            kind={kind}
            rule={rule}
            onChange={onChange}
            onUndoableChange={onUndoableChange}
          />
        ))}
      </div>
    );
  if (tab === "escalation")
    return (
      <EscalationField
        value={rule.actions}
        onChange={(actions) => onChange({ ...rule, actions })}
      />
    );
  return (
    <div className="space-y-4">
      {rule.sourceRefs.length > 0 && (
        <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
          {t("playbooks.source")} {describeSourceRefs(rule.sourceRefs, t)}
        </p>
      )}
      <PlaybookRuleOrigin rule={rule} provenance={provenance} />
      <div className="grid gap-4 @[32rem]:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor={scopeId}
            className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}
          >
            {t("playbooks.scope")}
          </label>
          <ModalSelect
            variant="flat"
            id={scopeId}
            value={rule.scope}
            onChange={(scope) =>
              onChange({ ...rule, scope: scope as PlaybookRule["scope"] })
            }
            options={[
              { value: "clause", label: t("playbooks.clause") },
              { value: "agreement", label: t("playbooks.wholeAgreement") },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">
            {t("playbooks.chooseWhetherThisRuleAppliesTo")}
          </p>
        </div>
        <div className="min-w-0">
          <label
            htmlFor={requiredId}
            className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}
          >
            {t("playbooks.requirement")}
          </label>
          <ModalSelect
            variant="flat"
            id={requiredId}
            value={rule.required ? "required" : "optional"}
            onChange={(value) =>
              onChange({ ...rule, required: value === "required" })
            }
            options={[
              { value: "optional", label: t("playbooks.optional2") },
              { value: "required", label: t("playbooks.required") },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">
            {rule.required
              ? t("playbooks.ifTheContractDoesntContainThis")
              : t("playbooks.theReviewDoesntFlagTheContract")}
          </p>
        </div>
      </div>
      <Field
        label={t("playbooks.conceptToDetect")}
        description={t("playbooks.describeTheTermSoTheReview")}
        value={rule.concept}
        onChange={(concept) => onChange({ ...rule, concept })}
        multiline
      />
      <ConditionsField
        value={rule.conditions}
        onChange={(conditions) => onChange({ ...rule, conditions })}
      />
      <Field
        label={t("playbooks.additionalGuidance")}
        description={t("playbooks.contextOrPrioritiesTheReviewShould")}
        value={rule.guidance}
        onChange={(guidance) => onChange({ ...rule, guidance })}
        multiline
      />
    </div>
  );
}

function parseLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Conditions are saved as one sentence each. The field keeps the typed text
 * so a blank line survives until the next condition is typed; the server
 * rejects an empty condition.
 */
function ConditionsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const helpId = useId();
  const [text, setText] = useState(() => value.join("\n"));
  // Adopt conditions replaced from outside, such as an undo or an import.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    if (parseLines(text).join("\n") !== value.join("\n"))
      setText(value.join("\n"));
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}>
        {t("playbooks.appliesOnlyWhen")}
      </label>
      <textarea
        id={id}
        value={text}
        rows={2}
        aria-describedby={helpId}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseLines(event.target.value);
          if (next.join("\n") !== value.join("\n")) onChange(next);
        }}
        className={`${PLAYBOOK_TEXTAREA_CLASS} min-h-[3.25rem]`}
      />
      <p id={helpId} className={PLAYBOOK_HELP_CLASS}>
        {t("playbooks.oneConditionPerLineLeaveEmpty")}
      </p>
    </div>
  );
}

function savedActions(rows: RuleAction[]) {
  return rows.filter((row) => row.instruction.trim());
}

function sameActions(a: RuleAction[], b: RuleAction[]) {
  return (
    a.length === b.length &&
    a.every(
      (row, index) =>
        row.scenario === b[index].scenario &&
        row.instruction === b[index].instruction,
    )
  );
}

/**
 * Escalations need an instruction before they can be saved, so rows being
 * written stay local until they have one.
 */
function EscalationField({
  value,
  onChange,
}: {
  value: RuleAction[];
  onChange: (value: RuleAction[]) => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    if (!sameActions(savedActions(rows), value)) setRows(value);
  }
  function commit(next: RuleAction[]) {
    setRows(next);
    const saved = savedActions(next);
    if (!sameActions(saved, value)) onChange(saved);
  }
  function addEscalation() {
    commit([...rows, { scenario: "", instruction: "" }]);
  }
  if (rows.length === 0)
    return (
      <EmptyState
        title={t("playbooks.escalations")}
        description={t("playbooks.describeASituationTheReviewMay")}
        className="m-auto w-fit max-w-full py-12"
        action={
          <PillButtonUI tone="black" onClick={addEscalation}>
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {t("playbooks.addEscalation")}
          </PillButtonUI>
        }
      />
    );
  return (
    <div className="min-w-0 space-y-4">
      {rows.map((row, index) => (
        <fieldset
          key={index}
          className={`min-w-0 space-y-3 rounded-xl px-3 pb-3 pt-1.5 md:px-4 md:pb-4 md:pt-2 ${LIQUID_GLASS_FLAT_CLASS}`}
        >
          <legend className="sr-only">{t("playbooks.escalation")} {index + 1}</legend>
          <div className="flex h-8 items-center justify-between gap-2">
            <span
              aria-hidden="true"
              className="text-sm font-medium text-gray-900"
            >
              {t("playbooks.escalation")} {index + 1}
            </span>
            <HeaderActionsMenu
              title={t("playbooks.actionsForEscalation", { n: index + 1 })}
              triggerClassName="h-6 w-6 shrink-0"
              items={[
                {
                  label: t("playbooks.duplicate"),
                  onSelect: () =>
                    commit([
                      ...rows.slice(0, index + 1),
                      { ...row },
                      ...rows.slice(index + 1),
                    ]),
                },
                {
                  label: t("playbooks.delete"),
                  variant: "danger" as const,
                  onSelect: () => commit(rows.filter((_, i) => i !== index)),
                },
              ]}
            />
          </div>
          <Field
            label={t("playbooks.when")}
            value={row.scenario}
            onChange={(scenario) =>
              commit(rows.map((r, i) => (i === index ? { ...r, scenario } : r)))
            }
          />
          <Field
            label={t("playbooks.then")}
            value={row.instruction}
            onChange={(instruction) =>
              commit(
                rows.map((r, i) => (i === index ? { ...r, instruction } : r)),
              )
            }
            multiline="grow"
          />
        </fieldset>
      ))}
      <TextButtonUI className="-ml-2" onClick={addEscalation}>
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        {t("playbooks.addEscalation")}
      </TextButtonUI>
    </div>
  );
}

function PositionGroup({
  kind,
  rule,
  onChange,
  onUndoableChange,
}: {
  kind: PositionKind;
  rule: PlaybookRule;
  onChange: (rule: PlaybookRule) => void;
  onUndoableChange: UndoableRuleChange;
}) {
  const t = useTranslations();
  const group = { ...POSITION_GROUPS[kind], ...positionText(kind, t) };
  const headingId = useId();
  const positions = positionsOf(rule, kind);
  const canAdd = kind !== "standard" || positions.length === 0;

  function setPositions(next: PlaybookPosition[]) {
    onChange(withPositions(rule, kind, next));
  }

  function removePosition(index: number) {
    const removed = positions[index];
    const next = withPositions(
      rule,
      kind,
      positions.filter((_, i) => i !== index),
    );
    if (!removed.criteria.trim() && removed.sampleClauses.length === 0) {
      onChange(next);
      return;
    }
    onUndoableChange(
      next,
      t("playbooks.removedPosition", { position: positionLabel(kind, index, t) }),
      (latest) => {
        const current = positionsOf(latest, kind);
        if (kind === "standard" && current.length) return latest;
        return withPositions(latest, kind, insertAt(current, index, removed));
      },
    );
  }

  function movePosition(index: number, offset: -1 | 1) {
    const next = [...positions];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setPositions(next);
  }

  function removeClause(positionIndex: number, clauseIndex: number) {
    const position = positions[positionIndex];
    const removed = position.sampleClauses[clauseIndex];
    const next = withPositions(
      rule,
      kind,
      positions.map((entry, i) =>
        i === positionIndex
          ? {
              ...entry,
              sampleClauses: entry.sampleClauses.filter(
                (_, j) => j !== clauseIndex,
              ),
            }
          : entry,
      ),
    );
    if (!removed.text.trim()) {
      onChange(next);
      return;
    }
    onUndoableChange(
      next,
      t("playbooks.removedClauseFromPosition", { clause: clauseIndex + 1, position: positionLabel(kind, positionIndex, t) }),
      (latest) => {
        const current = positionsOf(latest, kind);
        if (!current[positionIndex]) return latest;
        return withPositions(
          latest,
          kind,
          current.map((entry, i) =>
            i === positionIndex
              ? {
                  ...entry,
                  sampleClauses: insertAt(
                    entry.sampleClauses,
                    clauseIndex,
                    removed,
                  ),
                }
              : entry,
          ),
        );
      },
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 space-y-3 rounded-2xl bg-gray-100/70 px-3 pb-3 pt-2 md:px-4 md:pb-4 md:pt-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h4
          id={headingId}
          className="flex items-center gap-2 text-sm font-medium text-gray-900"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${group.dot}`}
          />
          {group.title}
        </h4>
        {canAdd && (
          <TextButtonUI
            onClick={() =>
              setPositions([
                ...positions,
                { name: group.label, criteria: "", sampleClauses: [] },
              ])
            }
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {t("playbooks.add")}
          </TextButtonUI>
        )}
      </div>
      {positions.length === 0 ? (
        <p className="text-xs text-gray-500">{group.empty}</p>
      ) : (
        positions.map((position, index) => (
          <PositionCard
            key={index}
            kind={kind}
            index={index}
            count={positions.length}
            position={position}
            onChange={(next) =>
              setPositions(positions.map((p, i) => (i === index ? next : p)))
            }
            onMove={(offset) => movePosition(index, offset)}
            onRemove={() => removePosition(index)}
            onRemoveClause={(clauseIndex) => removeClause(index, clauseIndex)}
          />
        ))
      )}
    </section>
  );
}

function PositionCard({
  kind,
  index,
  count,
  position,
  onChange,
  onMove,
  onRemove,
  onRemoveClause,
}: {
  kind: PositionKind;
  index: number;
  count: number;
  position: PlaybookPosition;
  onChange: (position: PlaybookPosition) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onRemoveClause: (clauseIndex: number) => void;
}) {
  const t = useTranslations();
  const label = positionLabel(kind, index, t);
  const ordered = kind !== "standard";
  return (
    <fieldset
      // The name field's own height adds space above its text, so the card's
      // top padding is smaller than its sides.
      className={`min-w-0 space-y-4 rounded-xl px-3 pb-3 pt-1.5 md:px-4 md:pb-4 md:pt-2 ${LIQUID_GLASS_FLAT_CLASS}`}
    >
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center gap-2">
        {ordered && (
          <span
            aria-hidden="true"
            className="shrink-0 text-sm tabular-nums text-gray-500"
          >
            {index + 1}.
          </span>
        )}
        <input
          aria-label={t("playbooks.labelName", { label })}
          value={position.name}
          placeholder={label}
          onChange={(event) =>
            onChange({ ...position, name: event.target.value })
          }
          className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm font-medium text-gray-900 outline-none transition-colors placeholder:text-gray-400 hover:bg-app-surface-hover focus-visible:ring-2 focus-visible:ring-focus"
        />
        <HeaderActionsMenu
          title={t("playbooks.actionsForLabel", { label })}
          triggerClassName="h-6 w-6 shrink-0"
          items={[
            ...(ordered && count > 1
              ? [
                  {
                    label: t("playbooks.moveUp"),
                    disabled: index === 0,
                    onSelect: () => onMove(-1),
                  },
                  {
                    label: t("playbooks.moveDown"),
                    disabled: index === count - 1,
                    onSelect: () => onMove(1),
                  },
                ]
              : []),
            {
              label: t("playbooks.removePosition"),
              variant: "danger" as const,
              onSelect: onRemove,
            },
          ]}
        />
      </div>
      <Field
        label={t("playbooks.criteria")}
        value={position.criteria}
        onChange={(criteria) => onChange({ ...position, criteria })}
        multiline
      />
      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h5 className={PLAYBOOK_LABEL_CLASS}>{t("playbooks.sampleClauses")}</h5>
          <TextButtonUI
            onClick={() =>
              onChange({
                ...position,
                sampleClauses: [
                  ...position.sampleClauses,
                  {
                    text: "",
                    usage: POSITION_GROUPS[kind].usage,
                    sourceRefs: [],
                  },
                ],
              })
            }
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {t("playbooks.addClause")}
          </TextButtonUI>
        </div>
        {position.sampleClauses.map((clause, clauseIndex) => (
          <SampleClause
            key={clauseIndex}
            kind={kind}
            index={clauseIndex}
            clause={clause}
            onChange={(next) =>
              onChange({
                ...position,
                sampleClauses: position.sampleClauses.map((entry, i) =>
                  i === clauseIndex ? next : entry,
                ),
              })
            }
            onRemove={() => onRemoveClause(clauseIndex)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function SampleClause({
  kind,
  index,
  clause,
  onChange,
  onRemove,
}: {
  kind: PositionKind;
  index: number;
  clause: PlaybookClause;
  onChange: (clause: PlaybookClause) => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const textId = useId();
  const usageId = useId();
  const conflictId = useId();
  const conflictKind = clauseUsageConflict(kind, clause.usage);
  const conflict =
    conflictKind === "unacceptable"
      ? t("playbooks.conflictsWithThisUnacceptablePosition")
      : conflictKind === "acceptable"
        ? t("playbooks.conflictsWithThisAcceptablePosition")
        : null;
  return (
    <div className={CLAUSE_TILE_CLASS}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-3 pr-1 pt-1">
        <label htmlFor={textId} className="text-xs font-medium text-gray-500">
          {t("playbooks.clause")} {index + 1}
        </label>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <ModalSelect
            variant="flat"
            id={usageId}
            aria-label={t("playbooks.clauseUsage", { n: index + 1 })}
            value={clause.usage}
            onChange={(usage) =>
              onChange({ ...clause, usage: usage as PlaybookClauseUsage })
            }
            options={usageOptions(t)}
            className="h-7 w-auto max-w-full gap-1 rounded-lg bg-transparent px-2 text-xs"
            menuClassName="w-44"
          />
          <TextButtonUI
            size="icon-xs"
            aria-label={t("playbooks.removeClauseN", { n: index + 1 })}
            title={t("playbooks.removeClause")}
            onClick={onRemove}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </TextButtonUI>
        </div>
      </div>
      <textarea
        id={textId}
        value={clause.text}
        rows={3}
        aria-describedby={conflict ? conflictId : undefined}
        onChange={(event) => onChange({ ...clause, text: event.target.value })}
        className={cn(
          PLAYBOOK_TEXTAREA_CLASS,
          "bg-transparent focus:border-transparent focus:ring-0",
        )}
      />
      {conflict && (
        <p id={conflictId} className="px-3 pb-2 text-xs text-warning">
          {conflict}
        </p>
      )}
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import { AlertCircle, Loader2, Play } from "lucide-react";
import { ModalSegmentedToggle } from "@/app/components/modals/ModalSegmentedToggle";
import { ModelToggle } from "@/app/components/assistant/ModelToggle";
import { NoModelsWarningPopup } from "@/app/components/popups/NoModelsWarningPopup";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useModelApiKeys } from "@/app/hooks/useModelApiKeys";
import { useModelRouterSelections } from "@/app/hooks/useModelRouterSelections";
import type { NoModelsReason } from "@mike/client";
import type { PlaybookReviewScope } from "@/app/lib/mikeApi";
import { EDITOR_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { PillButtonUI } from "@mike/ui";
import {
  PLAYBOOK_HELP_CLASS,
  PLAYBOOK_LABEL_CLASS,
  PLAYBOOK_TEXTAREA_CLASS,
} from "./PlaybookField";
import {
  PlaybookReviewDocuments,
  type ReviewDocument,
} from "./PlaybookReviewDocuments";
import {
  PLAYBOOK_PANE_BODY_CLASS,
  PLAYBOOK_PANE_HEADER_CLASS,
  PLAYBOOK_PANE_INSET_CLASS,
  PLAYBOOK_PANE_TITLE_CLASS,
} from "./playbookPaneStyles";
import { useTranslations } from "next-intl";

export type ReviewMode = "strict" | "permissive";


/**
 * Sets up a run of the playbook, in the Runs tab's main pane: the documents
 * to review and how to review them.
 */
export function PlaybookNewRun({
  documents,
  onAddFiles,
  onRemoveDocument,
  onAddDocuments,
  instructions,
  onInstructionsChange,
  model,
  onModelChange,
  mode,
  onModeChange,
  scope,
  onScopeChange,
  error,
  reviewing,
  disabled,
  onStart,
  onCancel,
}: {
  documents: ReviewDocument[];
  onAddFiles: (files: File[]) => void;
  onRemoveDocument: (id: string) => void;
  /** Opens the add-documents dialog: saved files, or new uploads. */
  onAddDocuments: () => void;
  instructions: string;
  onInstructionsChange: (instructions: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  mode: ReviewMode;
  onModeChange: (mode: ReviewMode) => void;
  scope: PlaybookReviewScope;
  onScopeChange: (scope: PlaybookReviewScope) => void;
  error: string | null;
  reviewing: boolean;
  /** Something else is in progress, or a review is running. */
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const headingId = useId();
  const documentsLabelId = useId();
  const instructionsId = useId();
  const instructionsHelpId = useId();
  const modelId = useId();
  const { profile, loading: profileLoading } = useUserProfile();
  const apiKeys = useModelApiKeys();
  const routerSelections = useModelRouterSelections();
  const [noModelsWarning, setNoModelsWarning] =
    useState<NoModelsReason | null>(null);
  const pending = documents.filter((item) => item.status !== "completed");
  const startLabel = reviewing
    ? t("playbooks.starting")
    : pending.length > 0 && pending.every((item) => item.status === "failed")
      ? t("playbooks.retryFailedDocuments")
      : pending.length > 1
        ? `Start ${pending.length} reviews`
        : t("playbooks.startReview");

  return (
    <section
      aria-labelledby={headingId}
      className={`@container flex min-h-[24rem] min-w-0 flex-1 flex-col overflow-hidden @[48rem]:min-h-0 ${EDITOR_SURFACE_CLASS}`}
    >
      <div className={PLAYBOOK_PANE_HEADER_CLASS}>
        <h2 id={headingId} className={PLAYBOOK_PANE_TITLE_CLASS}>
          {t("playbooks.newRun")}
        </h2>
      </div>
      <div
        className={`min-h-0 flex-1 space-y-5 overflow-y-auto ${PLAYBOOK_PANE_BODY_CLASS}`}
      >
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 text-sm text-red-600"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div>
          <p
            id={documentsLabelId}
            className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}
          >
            {t("playbooks.addDocuments")}
          </p>
          <PlaybookReviewDocuments
            documents={documents}
            disabled={disabled}
            onAdd={onAddFiles}
            onAddDocuments={onAddDocuments}
            onRemove={onRemoveDocument}
            labelledBy={documentsLabelId}
          />
        </div>
        <div className="grid min-w-0 gap-5 @[36rem]:grid-cols-2">
          <ChoiceField
            label={t("playbooks.scope")}
            value={scope}
            onChange={onScopeChange}
            disabled={disabled}
            options={[
              { value: "full", label: t("playbooks.fullReview") },
              { value: "issues", label: t("playbooks.issuesOnly") },
            ]}
            description={
              scope === "issues"
                ? t("playbooks.reportsOnlyUnacceptableMissingAndNeeds")
                : t("playbooks.checksEveryRuleAndListsWhat")
            }
          />
          <ChoiceField
            label={t("playbooks.posture")}
            value={mode}
            onChange={onModeChange}
            disabled={disabled}
            options={[
              { value: "strict", label: t("playbooks.strict") },
              { value: "permissive", label: t("playbooks.permissive") },
            ]}
            description={
              mode === "permissive"
                ? t("playbooks.anAcceptableFallbackPositionPassesAnd")
                : t("playbooks.clausesThatOnlyMeetAFallback")
            }
          />
        </div>
        <div className="min-w-0">
          <p id={modelId} className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}>
            {t("playbooks.reviewModel")}
          </p>
          <div role="group" aria-labelledby={modelId}>
            <ModelToggle
              value={model}
              onChange={onModelChange}
              apiKeys={apiKeys}
              apiKeysLoading={profileLoading && !profile}
              routerSelections={routerSelections}
              onNoModelsClick={setNoModelsWarning}
              // Grey and flat, like the pane's other fields.
              modalInput="flat"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor={instructionsId}
            className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}
          >
            {t("playbooks.additionalInstructions")}
          </label>
          {/* Empty by default: the review already knows how to review. */}
          <textarea
            id={instructionsId}
            disabled={disabled}
            value={instructions}
            onChange={(event) => onInstructionsChange(event.target.value)}
            aria-describedby={instructionsHelpId}
            className={PLAYBOOK_TEXTAREA_CLASS}
          />
          <p id={instructionsHelpId} className={PLAYBOOK_HELP_CLASS}>
            {t("playbooks.optional")}
          </p>
        </div>
      </div>
      <div
        className={`flex shrink-0 flex-wrap items-center gap-2 pb-4 pt-3 md:pb-5 ${PLAYBOOK_PANE_INSET_CLASS}`}
      >
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={reviewing}
            className="rounded-md px-2 py-1.5 text-sm text-gray-500 transition-colors hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("playbooks.cancel")}
          </button>
          <PillButtonUI
            tone="blue"
            size="normal"
            disabled={!pending.length || !model || disabled}
            onClick={onStart}
          >
            {reviewing ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4" />
            )}
            {startLabel}
          </PillButtonUI>
        </div>
      </div>
      <NoModelsWarningPopup
        reason={noModelsWarning}
        onClose={() => setNoModelsWarning(null)}
      />
    </section>
  );
}

/** A two-way choice with a line on what the current one does. */
function ChoiceField<T extends string>({
  label,
  value,
  onChange,
  options,
  description,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  description: string;
  disabled: boolean;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      className="min-w-0"
    >
      <p id={labelId} className={`mb-2 block ${PLAYBOOK_LABEL_CLASS}`}>
        {label}
      </p>
      <ModalSegmentedToggle
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        // The pane is white; a flat track keeps its edge visible.
        surface="flat"
      />
      <p id={descriptionId} className={PLAYBOOK_HELP_CLASS}>
        {description}
      </p>
    </div>
  );
}

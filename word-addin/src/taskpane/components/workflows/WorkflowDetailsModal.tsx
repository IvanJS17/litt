import { clientTranslator } from "@mike/client";
import React, { useEffect, useRef, useState } from "react";
import { WorkflowSlashCommandUI } from "@mike/ui";
import type { Workflow } from "../../types";
import { deleteWorkflow, updateWorkflow } from "../../api/mikeApi";
import { Modal } from "../primitives/Modal";
import {
  ModalFieldLabel,
  ModalSelect,
  ModalTextInput,
} from "../primitives/ModalForm";
import {
  DEFAULT_WORKFLOW_JURISDICTION,
  DEFAULT_WORKFLOW_LANGUAGE,
  DEFAULT_WORKFLOW_PRACTICE,
  WORKFLOW_JURISDICTION_OPTIONS,
  WORKFLOW_LANGUAGE_OPTIONS,
  WORKFLOW_OTHER_OPTION,
  WORKFLOW_PRACTICE_OPTIONS,
} from "../../lib/workflowMetadata";
import { reportFault } from "../../lib/notify";
import { useTranslations } from "use-intl";

function valueOrOther(
  value: string,
  options: readonly string[],
): { selected: string; custom: string } {
  return options.includes(value)
    ? { selected: value, custom: "" }
    : { selected: WORKFLOW_OTHER_OPTION, custom: value };
}

interface WorkflowDetailsModalProps {
  open: boolean;
  workflow: Workflow | null;
  onClose: () => void;
  onUpdated: (workflow: Workflow) => void;
  onDeleted: (workflowId: string) => void;
  deleteConfirmOpen: boolean;
  onDeleteConfirmOpenChange: (open: boolean) => void;
}

export function WorkflowDetailsModal({
  open,
  workflow,
  onClose,
  onUpdated,
  onDeleted,
  deleteConfirmOpen,
  onDeleteConfirmOpenChange,
}: WorkflowDetailsModalProps): React.ReactElement | null {
  const t = useTranslations();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState(DEFAULT_WORKFLOW_LANGUAGE);
  const [customLanguage, setCustomLanguage] = useState("");
  const [practice, setPractice] = useState(DEFAULT_WORKFLOW_PRACTICE);
  const [customPractice, setCustomPractice] = useState("");
  const [jurisdiction, setJurisdiction] = useState(
    DEFAULT_WORKFLOW_JURISDICTION,
  );
  const [customJurisdiction, setCustomJurisdiction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const initializedWorkflowIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !workflow) {
      initializedWorkflowIdRef.current = null;
      return;
    }
    if (initializedWorkflowIdRef.current === workflow.id) return;
    initializedWorkflowIdRef.current = workflow.id;
    setTitle(workflow.metadata.title);

    const nextLanguage = valueOrOther(
      workflow.metadata.language || DEFAULT_WORKFLOW_LANGUAGE,
      WORKFLOW_LANGUAGE_OPTIONS,
    );
    setLanguage(nextLanguage.selected);
    setCustomLanguage(nextLanguage.custom);

    const nextPractice = valueOrOther(
      workflow.metadata.practice || DEFAULT_WORKFLOW_PRACTICE,
      WORKFLOW_PRACTICE_OPTIONS,
    );
    setPractice(nextPractice.selected);
    setCustomPractice(nextPractice.custom);

    const savedJurisdiction = workflow.metadata.jurisdictions?.length
      ? workflow.metadata.jurisdictions.join(", ")
      : DEFAULT_WORKFLOW_JURISDICTION;
    const nextJurisdiction = valueOrOther(
      savedJurisdiction,
      WORKFLOW_JURISDICTION_OPTIONS,
    );
    setJurisdiction(nextJurisdiction.selected);
    setCustomJurisdiction(nextJurisdiction.custom);
    setError(null);
    setDeleting(false);
    setDeleteError(null);
  }, [open, workflow]);

  useEffect(() => {
    if (deleteConfirmOpen) setDeleteError(null);
  }, [deleteConfirmOpen]);

  if (!workflow) return null;

  const readOnly = workflow.is_system || workflow.allow_edit === false;
  const effectiveLanguage =
    language === WORKFLOW_OTHER_OPTION ? customLanguage.trim() : language;
  const effectivePractice =
    practice === WORKFLOW_OTHER_OPTION ? customPractice.trim() : practice;
  const effectiveJurisdiction =
    jurisdiction === WORKFLOW_OTHER_OPTION ? customJurisdiction : jurisdiction;
  const jurisdictions = effectiveJurisdiction
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const initialLanguage =
    workflow.metadata.language || DEFAULT_WORKFLOW_LANGUAGE;
  const initialPractice =
    workflow.metadata.practice || DEFAULT_WORKFLOW_PRACTICE;
  const initialJurisdictions = workflow.metadata.jurisdictions ?? [];
  const hasChanges =
    title.trim() !== workflow.metadata.title.trim() ||
    effectiveLanguage !== initialLanguage ||
    effectivePractice !== initialPractice ||
    JSON.stringify(jurisdictions) !== JSON.stringify(initialJurisdictions);

  const handleSave = async (): Promise<void> => {
    if (readOnly || !title.trim() || saving || !hasChanges) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateWorkflow(workflow.id, {
        metadata: {
          title: title.trim(),
          language: effectiveLanguage || null,
          practice: effectivePractice || null,
          jurisdictions: jurisdictions.length ? jurisdictions : null,
        },
      });
      onUpdated({
        ...workflow,
        ...updated,
        metadata: { ...workflow.metadata, ...updated.metadata },
      });
      onClose();
    } catch (reason) {
      setError(
        reportFault(reason, {
          fallback: clientTranslator()("word.saveWorkflowFailed"),
          operation: "workflows.run",
        }).message,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (readOnly || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWorkflow(workflow.id);
      onDeleted(workflow.id);
      onDeleteConfirmOpenChange(false);
      onClose();
    } catch (reason) {
      setDeleteError(
        reportFault(reason, {
          fallback: clientTranslator()("word.deleteWorkflowFailed"),
          operation: "workflows.run",
        }).message,
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        parentLabel="Workflows"
        title={t("word.viewAndEditDetails")}
        primaryAction={
          readOnly
            ? undefined
            : {
                label: saving ? t("word.saving") : t("word.save"),
                onClick: () => void handleSave(),
                disabled: !title.trim() || saving || !hasChanges,
              }
        }
      >
        <div data-modal-scroll="vertical" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-5">
          <div className="space-y-6">
            <div>
              <ModalFieldLabel htmlFor="workflow-details-title">
                {t("word.title")}
              </ModalFieldLabel>
              <ModalTextInput
                id="workflow-details-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("word.addWorkflowName")}
                variant="minimal"
                disabled={readOnly}
              />
              <WorkflowSlashCommandUI title={title} />
            </div>

            <div>
              <ModalFieldLabel htmlFor="workflow-details-language">
                {t("word.language2")}
              </ModalFieldLabel>
              <ModalSelect
                id="workflow-details-language"
                value={language}
                options={WORKFLOW_LANGUAGE_OPTIONS}
                disabled={readOnly}
                onChange={(value) => {
                  setLanguage(value);
                  if (value !== WORKFLOW_OTHER_OPTION) setCustomLanguage("");
                }}
              />
              {language === WORKFLOW_OTHER_OPTION && (
                <ModalTextInput
                  value={customLanguage}
                  onChange={(event) => setCustomLanguage(event.target.value)}
                  placeholder={t("word.enterLanguage")}
                  disabled={readOnly}
                  className="mt-2"
                />
              )}
            </div>

            <div>
              <ModalFieldLabel htmlFor="workflow-details-practice">
                {t("word.practiceArea")}
              </ModalFieldLabel>
              <ModalSelect
                id="workflow-details-practice"
                value={practice}
                options={WORKFLOW_PRACTICE_OPTIONS}
                disabled={readOnly}
                onChange={(value) => {
                  setPractice(value);
                  if (value !== WORKFLOW_OTHER_OPTION) setCustomPractice("");
                }}
              />
              {practice === WORKFLOW_OTHER_OPTION && (
                <ModalTextInput
                  value={customPractice}
                  onChange={(event) => setCustomPractice(event.target.value)}
                  placeholder={t("word.enterPracticeArea")}
                  disabled={readOnly}
                  className="mt-2"
                />
              )}
            </div>

            <div>
              <ModalFieldLabel htmlFor="workflow-details-jurisdiction">
                {t("word.jurisdiction")}
              </ModalFieldLabel>
              <ModalSelect
                id="workflow-details-jurisdiction"
                value={jurisdiction}
                options={WORKFLOW_JURISDICTION_OPTIONS}
                disabled={readOnly}
                onChange={(value) => {
                  setJurisdiction(value);
                  if (value !== WORKFLOW_OTHER_OPTION) setCustomJurisdiction("");
                }}
              />
              {jurisdiction === WORKFLOW_OTHER_OPTION && (
                <ModalTextInput
                  value={customJurisdiction}
                  onChange={(event) =>
                    setCustomJurisdiction(event.target.value)
                  }
                  placeholder={t("word.enterJurisdiction")}
                  disabled={readOnly}
                  className="mt-2"
                />
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteConfirmOpen}
        onClose={() => !deleting && onDeleteConfirmOpenChange(false)}
        parentLabel="Workflows"
        title={t("word.deleteWorkflow")}
        primaryAction={{
          label: deleting ? t("word.deleting") : t("word.delete"),
          tone: "danger",
          disabled: deleting,
          onClick: () => void handleDelete(),
        }}
        secondaryAction={{
          label: t("word.cancel"),
          disabled: deleting,
          onClick: () => onDeleteConfirmOpenChange(false),
        }}
      >
        <div className="pb-5 text-sm leading-6 text-gray-600">
          <p>
            {workflow.is_default
              ? t("word.deletingThisDefaultWorkflowAlsoPermanently")
              : t("word.thisWorkflowWillBePermanentlyDeleted")}
          </p>
          {deleteError && (
            <p role="alert" className="mt-3 text-red-500">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

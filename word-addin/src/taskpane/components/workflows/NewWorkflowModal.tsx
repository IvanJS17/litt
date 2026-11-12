import { clientTranslator } from "@mike/client";
import React, { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { WorkflowSlashCommandUI } from "@mike/ui";
import type { Workflow } from "../../types";
import { createWorkflow } from "../../api/mikeApi";
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
  WORKFLOW_PRACTICE_OPTIONS,
} from "../../lib/workflowMetadata";
import { reportFault } from "../../lib/notify";
import { useTranslations } from "use-intl";

const US_STATE_OPTIONS = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
  "District of Columbia",
] as const;

const CANADA_PROVINCE_OPTIONS = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
] as const;

interface NewWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (workflow: Workflow) => void;
}

export function NewWorkflowModal({
  open,
  onClose,
  onCreated,
}: NewWorkflowModalProps): React.ReactElement | null {
  const t = useTranslations();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState(DEFAULT_WORKFLOW_LANGUAGE);
  const [customLanguage, setCustomLanguage] = useState("");
  const [practice, setPractice] = useState(DEFAULT_WORKFLOW_PRACTICE);
  const [customPractice, setCustomPractice] = useState("");
  const [jurisdiction, setJurisdiction] = useState(
    DEFAULT_WORKFLOW_JURISDICTION
  );
  const [jurisdictionRegion, setJurisdictionRegion] = useState("");
  const [customJurisdiction, setCustomJurisdiction] = useState("");
  const [importedMarkdown, setImportedMarkdown] = useState("");
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);

  const reset = (): void => {
    setTitle("");
    setLanguage(DEFAULT_WORKFLOW_LANGUAGE);
    setCustomLanguage("");
    setPractice(DEFAULT_WORKFLOW_PRACTICE);
    setCustomPractice("");
    setJurisdiction(DEFAULT_WORKFLOW_JURISDICTION);
    setJurisdictionRegion("");
    setCustomJurisdiction("");
    setImportedMarkdown("");
    setImportedFileName(null);
    setError(null);
    if (markdownInputRef.current) markdownInputRef.current.value = "";
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  if (!open) return null;

  const close = (): void => {
    if (creating) return;
    reset();
    onClose();
  };

  const create = async (): Promise<void> => {
    if (!title.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const effectiveLanguage =
        language === "Other" ? customLanguage.trim() : language;
      const effectivePractice =
        practice === "Other" ? customPractice.trim() : practice;
      const effectiveJurisdiction =
        jurisdiction === "Other"
          ? customJurisdiction.trim()
          : jurisdictionRegion || jurisdiction;
      const workflow = await createWorkflow({
        metadata: {
          title: title.trim(),
          type: "assistant",
          language: effectiveLanguage || null,
          practice: effectivePractice || null,
          jurisdictions: effectiveJurisdiction
            ? effectiveJurisdiction
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : null,
        },
        ...(importedMarkdown ? { skill_md: importedMarkdown } : {}),
      });
      onCreated(workflow);
      reset();
      onClose();
    } catch (reason) {
      setError(
        reportFault(reason, {
          fallback: clientTranslator()("word.createWorkflowFailed"),
          operation: "workflows.run",
        }).message
      );
    } finally {
      setCreating(false);
    }
  };

  const importMarkdown = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(?:md|markdown)$/i.test(file.name)) {
      setImportedMarkdown("");
      setImportedFileName(null);
      setError(t("word.chooseAMdOrMarkdownFile"));
      event.target.value = "";
      return;
    }
    try {
      setImportedMarkdown(await file.text());
      setImportedFileName(file.name);
      setError(null);
    } catch {
      setImportedMarkdown("");
      setImportedFileName(null);
      setError(t("word.couldNotReadThatMarkdownFile"));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      parentLabel="Workflows"
      title={t("word.newWorkflow")}
      primaryAction={{
        label: creating ? t("word.creating") : t("word.createWorkflow"),
        onClick: () => void create(),
        disabled: !title.trim() || creating,
      }}
      secondaryAction={{
        label: importedFileName ?? t("word.uploadMarkdown"),
        icon: <Upload className="h-3.5 w-3.5" />,
        onClick: () => markdownInputRef.current?.click(),
        disabled: creating,
      }}
    >
      <div data-modal-scroll="vertical" className="min-h-0 flex-1 overflow-y-auto pb-5">
        <div className="space-y-6">
          <div>
            <ModalFieldLabel htmlFor="new-workflow-title">
              {t("word.title")}
            </ModalFieldLabel>
            <ModalTextInput
              id="new-workflow-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("word.addWorkflowName")}
              variant="minimal"
              autoFocus
            />
            <WorkflowSlashCommandUI title={title} />
          </div>

          <div>
            <ModalFieldLabel htmlFor="new-workflow-language">
              {t("word.language2")}
            </ModalFieldLabel>
            <ModalSelect
              id="new-workflow-language"
              value={language}
              options={WORKFLOW_LANGUAGE_OPTIONS}
              onChange={(value) => {
                setLanguage(value);
                if (value !== "Other") setCustomLanguage("");
              }}
            />
            {language === "Other" && (
              <ModalTextInput
                value={customLanguage}
                onChange={(event) => setCustomLanguage(event.target.value)}
                placeholder={t("word.enterLanguage")}
                className="mt-2"
              />
            )}
          </div>

          <div>
            <ModalFieldLabel htmlFor="new-workflow-practice">
              {t("word.practiceArea")}
            </ModalFieldLabel>
            <ModalSelect
              id="new-workflow-practice"
              value={practice}
              options={WORKFLOW_PRACTICE_OPTIONS}
              onChange={(value) => {
                setPractice(value);
                if (value !== "Other") setCustomPractice("");
              }}
            />
            {practice === "Other" && (
              <ModalTextInput
                value={customPractice}
                onChange={(event) => setCustomPractice(event.target.value)}
                placeholder={t("word.enterPracticeArea")}
                className="mt-2"
              />
            )}
          </div>

          <div>
            <ModalFieldLabel htmlFor="new-workflow-jurisdiction">
              {t("word.jurisdiction")}
            </ModalFieldLabel>
            <ModalSelect
              id="new-workflow-jurisdiction"
              value={jurisdiction}
              options={WORKFLOW_JURISDICTION_OPTIONS}
              onChange={(value) => {
                setJurisdiction(value);
                setJurisdictionRegion("");
                if (value !== "Other") setCustomJurisdiction("");
              }}
            />
            {(jurisdiction === "United States" ||
              jurisdiction === "Canada") && (
              <ModalSelect
                id="new-workflow-jurisdiction-region"
                value={jurisdictionRegion}
                options={
                  jurisdiction === "United States"
                    ? US_STATE_OPTIONS
                    : CANADA_PROVINCE_OPTIONS
                }
                onChange={setJurisdictionRegion}
                placeholder={
                  jurisdiction === "United States"
                    ? t("word.selectState")
                    : t("word.selectProvince")
                }
                className="mt-2"
              />
            )}
            {jurisdiction === "Other" && (
              <ModalTextInput
                value={customJurisdiction}
                onChange={(event) => setCustomJurisdiction(event.target.value)}
                placeholder={t("word.enterJurisdiction")}
                className="mt-2"
              />
            )}
          </div>

          {importedFileName && (
            <p className="text-xs text-gray-500">
              {t("word.theImportedMarkdownWillBecomeThe")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}
        </div>
        <input
          ref={markdownInputRef}
          type="file"
          className="hidden"
          accept=".md,.markdown,text/markdown,text/x-markdown,text/plain"
          onChange={(event) => void importMarkdown(event)}
        />
      </div>
    </Modal>
  );
}

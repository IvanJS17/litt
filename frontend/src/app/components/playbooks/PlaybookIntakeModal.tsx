"use client";

// LiTT playbooks with a starting point, layer 1: "With questions". Ten fixed
// questions, all optional, and the client's preferred clauses for question 8.
// The model writes a draft from them on the server; the draft is followed like
// an import. The questions are product text (the catalog); what the lawyer
// writes is sent as written.

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, WandSparkles } from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { ModalFieldLabel } from "@/app/components/modals/ModalFieldLabel";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ModalTextInput } from "@/app/components/modals/ModalTextInput";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { AccessVisibilityField } from "@/app/components/modals/AccessVisibilityField";
import { AddDocumentsModal } from "@/app/components/modals/AddDocumentsModal";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import type { ContentVisibility, Document } from "@/app/components/shared/types";
import {
  getPlaybookQuestionnaire,
  type PlaybookQuestionnaire,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
  PlaybookReviewDocuments,
  type ReviewDocument,
} from "./PlaybookReviewDocuments";

const ATTACHMENT_FILE = /\.(docx|pdf)$/i;

export type PlaybookIntakeRequest = {
  name: string;
  visibility: ContentVisibility;
  /** Answered questions only, trimmed. */
  answers: Record<string, string>;
  attachments: Array<File | { documentId: string }>;
};

function attachmentOf(item: File | Document): ReviewDocument {
  return item instanceof File
    ? {
        id: JSON.stringify(["upload", item.name, item.size, item.lastModified]),
        name: item.name,
        kind: "upload",
        file: item,
        status: "ready",
      }
    : {
        id: JSON.stringify(["saved", item.id]),
        name: item.filename,
        kind: "saved",
        document: item,
        status: "ready",
      };
}

export function PlaybookIntakeModal({
  open,
  organizationName,
  models,
  model,
  onModelChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The organization's name, or null in a personal workspace. */
  organizationName: string | null;
  models: { value: string; label: string }[];
  model: string;
  onModelChange: (model: string) => void;
  /** Closes the dialog; its answers are kept until the caller remounts it. */
  onClose: () => void;
  /** Resolves true once the draft is on its way; on false the caller has said why. */
  onSubmit: (request: PlaybookIntakeRequest) => Promise<boolean>;
}) {
  const t = useTranslations("playbooks.intake");
  const tCommon = useTranslations("common");
  const ids = { name: useId(), model: useId(), attachments: useId(), intro: useId() };
  const [questionnaire, setQuestionnaire] = useState<PlaybookQuestionnaire | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<ContentVisibility>("private");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<ReviewDocument[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    if (!open || questionnaire) return;
    let current = true;
    getPlaybookQuestionnaire().then(
      (loaded) => {
        if (current) setQuestionnaire(loaded);
      },
      (error) => {
        if (!current) return;
        setLoadFailed(true);
        // The notice classifies the failure, offers Retry only when it is
        // honest and Contact support only when the lawyer cannot fix it.
        notifyError(error, {
          action: t("loadAction"),
          onRetry: () => {
            setLoadFailed(false);
            setLoadAttempt((count) => count + 1);
          },
        });
      },
    );
    return () => {
      current = false;
    };
    // `t` is stable for a locale; a new one only restarts a load that failed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, questionnaire, loadAttempt]);

  const answered = Object.fromEntries(
    Object.entries(answers)
      .map(([id, text]) => [id, text.trim()] as const)
      .filter(([, text]) => text),
  );
  const total = Object.values(answered).reduce((sum, text) => sum + text.length, 0);
  const maxAttachments = questionnaire?.maxAttachments ?? 5;
  const tooLong = !!questionnaire && total > questionnaire.maxAnswersChars;
  const dirty = !!name.trim() || Object.keys(answered).length > 0 || attachments.length > 0;

  function addAttachments(items: Array<File | Document>) {
    const supported = items.filter((item) =>
      ATTACHMENT_FILE.test(item instanceof File ? item.name : item.filename),
    );
    const seen = new Set(attachments.map((item) => item.id));
    const added = supported.map(attachmentOf).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    const next = [...attachments, ...added];
    setProblem(
      supported.length < items.length
        ? t("wrongType")
        : next.length > maxAttachments
          ? t("tooManyAttachments", { max: maxAttachments })
          : null,
    );
    setAttachments(next.slice(0, maxAttachments));
  }

  function reset() {
    setName("");
    setVisibility("private");
    setAnswers({});
    setAttachments([]);
    setProblem(null);
  }

  function requestClose() {
    if (submitting) return;
    if (dirty) setDiscarding(true);
    else onClose();
  }

  async function submit() {
    if (!questionnaire || tooLong || !model || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        visibility,
        answers: answered,
        attachments: attachments.map((item) =>
          item.kind === "upload" ? item.file : { documentId: item.document.id },
        ),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Modal
        open={open && !pickerOpen}
        onClose={requestClose}
        breadcrumbs={[t("breadcrumb"), t("title")]}
        primaryAction={{
          label: submitting ? t("submitting") : t("submit"),
          icon: submitting ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <WandSparkles aria-hidden="true" className="h-4 w-4" />
          ),
          variant: "blue",
          disabled: !questionnaire || tooLong || !model || submitting,
          onClick: () => void submit(),
        }}
        cancelAction={{ label: tCommon("cancel"), onClick: requestClose, disabled: submitting }}
      >
        <form
          data-modal-scroll="vertical"
          aria-describedby={ids.intro}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p id={ids.intro} className="text-sm text-gray-600">
            {t("intro")}
          </p>
          <div>
            <ModalFieldLabel htmlFor={ids.name}>{t("name")}</ModalFieldLabel>
            <ModalTextInput
              id={ids.name}
              value={name}
              maxLength={200}
              disabled={submitting}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {organizationName !== null && (
            <AccessVisibilityField
              visibility={visibility}
              onChange={setVisibility}
              organizationName={organizationName}
              resourceNoun="playbook"
              disabled={submitting}
            />
          )}
          {questionnaire ? (
            <ol className="space-y-5">
              {questionnaire.questions.map((question, index) => (
                <IntakeQuestion
                  key={question.id}
                  id={question.id}
                  number={index + 1}
                  text={
                    t.has(`questions.${question.id}` as never)
                      ? t(`questions.${question.id}` as never)
                      : question.text
                  }
                  help={question.id === "q8" ? t("q8Help", { max: maxAttachments }) : undefined}
                  value={answers[question.id] ?? ""}
                  maxLength={questionnaire.maxAnswerChars}
                  disabled={submitting}
                  onChange={(value) =>
                    setAnswers((current) => ({ ...current, [question.id]: value }))
                  }
                />
              ))}
            </ol>
          ) : loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-600">
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{t("loadFailed")}</span>
            </div>
          ) : (
            <ol role="status" aria-busy="true" aria-label={t("loading")} className="space-y-5">
              {Array.from({ length: 10 }, (_, index) => (
                <li key={index} className="space-y-2">
                  <SkeletonLine className="w-2/3" />
                  <div className="h-24 rounded-xl bg-gray-100 animate-pulse motion-reduce:animate-none" />
                </li>
              ))}
            </ol>
          )}
          <div>
            <p id={ids.attachments} className="mb-2 block text-xs font-medium text-gray-700">
              {t("attachments")}
            </p>
            <PlaybookReviewDocuments
              documents={attachments}
              disabled={submitting}
              onAdd={addAttachments}
              onAddDocuments={() => setPickerOpen(true)}
              onRemove={(id) => {
                setProblem(null);
                setAttachments((items) => items.filter((item) => item.id !== id));
              }}
              labelledBy={ids.attachments}
              emptyPrompt={t("attachPrompt")}
              addMorePrompt={t("attachMorePrompt")}
              dropPrompt={t("attachMorePrompt")}
            />
          </div>
          <div>
            <ModalFieldLabel htmlFor={ids.model}>{t("model")}</ModalFieldLabel>
            {models.length > 0 ? (
              <ModalSelect
                id={ids.model}
                value={model}
                onChange={onModelChange}
                options={models}
                menuClassName="max-h-64"
              />
            ) : (
              <p className="text-sm text-orange-700">
                {t.rich("noModel", {
                  link: (chunks) => (
                    <a
                      href="/account/api-keys"
                      className="rounded-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            )}
          </div>
          {(problem || tooLong) && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {tooLong && questionnaire
                  ? t("tooLong", { max: questionnaire.maxAnswersChars })
                  : problem}
              </span>
            </p>
          )}
          {questionnaire && Object.keys(answered).length === 0 && attachments.length === 0 && (
            <p className="text-sm text-orange-700">{t("noAnswers")}</p>
          )}
        </form>
      </Modal>
      <AddDocumentsModal
        open={open && pickerOpen}
        onClose={() => setPickerOpen(false)}
        breadcrumb={[t("breadcrumb"), t("title"), t("attachments")]}
        uploadStateId="playbook-intake"
        onSelect={(documents) => {
          setPickerOpen(false);
          addAttachments(documents);
        }}
      />
      <ConfirmPopup
        open={discarding}
        title={t("discardTitle")}
        message={t("discardMessage")}
        confirmLabel={t("discard")}
        cancelLabel={tCommon("cancel")}
        confirmVariant="danger"
        onConfirm={() => {
          setDiscarding(false);
          reset();
          onClose();
        }}
        onCancel={() => setDiscarding(false)}
      />
    </>
  );
}

function IntakeQuestion({
  id,
  number,
  text,
  help,
  value,
  maxLength,
  disabled,
  onChange,
}: {
  id: string;
  number: number;
  text: string;
  help?: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("playbooks.intake");
  const inputId = useId();
  const helpId = useId();
  return (
    <li data-question={id} className="min-w-0">
      <ModalFieldLabel htmlFor={inputId} className="text-sm">
        <span className="sr-only">{t("question", { number })}: </span>
        <span aria-hidden="true" className="mr-1 text-gray-500">
          {number}.
        </span>
        {text}
      </ModalFieldLabel>
      <ModalTextarea
        id={inputId}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        aria-describedby={help ? helpId : undefined}
        className="min-h-20 resize-y"
        onChange={(event) => onChange(event.target.value)}
      />
      {help && (
        <p id={helpId} className="mt-1.5 text-xs text-gray-500">
          {help}
        </p>
      )}
    </li>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { DocumentPill } from "@/app/components/shared/DocumentPill";
import type { Document } from "@/app/components/shared/types";

export type ReviewDocument = {
  id: string;
  name: string;
  status: "ready" | "reviewing" | "completed" | "failed";
  error?: string;
} & ({ kind: "upload"; file: File } | { kind: "saved"; document: Document });

export function PlaybookReviewDocuments({
  documents,
  disabled,
  onAdd,
  onAddDocuments,
  onRemove,
  labelledBy,
  emptyPrompt: emptyPromptProp,
  addMorePrompt: addMorePromptProp,
  dropPrompt: dropPromptProp,
}: {
  documents: ReviewDocument[];
  disabled: boolean;
  /** Files dropped on the area. */
  onAdd: (files: File[]) => void;
  /** Opens the add-documents dialog: saved files, or new uploads. */
  onAddDocuments: () => void;
  onRemove: (id: string) => void;
  /** The field label that names the area. */
  labelledBy: string;
  /** What the empty area asks for. */
  emptyPrompt?: string;
  /** What the area says once it holds documents. */
  addMorePrompt?: string;
  /** What the area says while files are dragged over it. */
  dropPrompt?: string;
}) {
  const t = useTranslations();
  const emptyPrompt = emptyPromptProp ?? t("playbooks.dragAndDropPdfDocxOrTxt");
  const addMorePrompt = addMorePromptProp ?? t("playbooks.dropMoreDocumentsHere");
  const dropPrompt = dropPromptProp ?? t("playbooks.dropDocumentsToAddThem");
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  return (
    <section
      aria-labelledby={labelledBy}
      aria-busy={disabled}
      className={`rounded-xl bg-gray-100 p-4 transition-colors ${dragging && !disabled ? "ring-2 ring-inset ring-interactive/40" : ""}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (!disabled) onAdd(Array.from(event.dataTransfer.files));
      }}
    >
      {documents.length ? (
        <>
          {disabled ? (
            <p className="mb-3 text-xs text-gray-500" aria-live="polite">
              {t("playbooks.countOfTotalStarted", { count: documents.filter((document) => document.status === "completed").length, total: documents.length })}
            </p>
          ) : (
            <button
              type="button"
              onClick={onAddDocuments}
              className="mb-3 block rounded-md text-left text-xs text-gray-500 transition-colors hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {dragging ? dropPrompt : addMorePrompt}
            </button>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {documents.map((document) => (
              <li key={document.id} className="min-w-0">
                {/* Each review runs on the server once started. */}
                <DocumentPill
                  filename={document.name}
                  fileType={
                    document.kind === "saved"
                      ? document.document.file_type
                      : document.name
                  }
                  icon={
                    document.status === "reviewing" ? (
                      <Loader2
                        aria-hidden="true"
                        className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none"
                      />
                    ) : document.status === "completed" ? (
                      <Check
                        aria-hidden="true"
                        className="h-2.5 w-2.5 text-green-600"
                      />
                    ) : document.status === "failed" ? (
                      <AlertCircle aria-hidden="true" className="h-2.5 w-2.5" />
                    ) : undefined
                  }
                  status={
                    document.status === "reviewing"
                      ? t("playbooks.starting")
                      : document.status === "completed"
                        ? t("playbooks.started")
                        : document.status === "failed"
                          ? t("playbooks.couldnTStart")
                          : undefined
                  }
                  tone={document.status === "failed" ? "error" : "default"}
                  onRemove={() => onRemove(document.id)}
                  removeDisabled={disabled}
                />
              </li>
            ))}
          </ul>
          {documents.some((document) => document.error) && (
            <ul role="alert" className="mt-2 space-y-1 text-xs text-red-600">
              {documents.map(
                (document) =>
                  document.error && (
                    <li key={document.id} className="[overflow-wrap:anywhere]">
                      {document.name}: {document.error}
                    </li>
                  ),
              )}
            </ul>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={onAddDocuments}
          disabled={disabled}
          className="w-full rounded-lg py-4 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed"
        >
          {/* The field's label sits above the area, as for other fields. */}
          <span className="block text-sm text-gray-700">
            {dragging ? dropPrompt : emptyPrompt}
          </span>
        </button>
      )}
    </section>
  );
}

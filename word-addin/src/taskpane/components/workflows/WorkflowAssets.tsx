import { clientTranslator } from "@mike/client";
import React, { useEffect, useRef, useState } from "react";
import type { Document } from "../../types";
import { isTrainingHeld, TrainingHeldNoteUI } from "@mike/ui";
import {
  deleteWorkflowAsset,
  getWorkflowAssetUrl,
  listWorkflowAssets,
  uploadWorkflowAssets,
  uploadWorkflowAssetVersion,
} from "../../api/mikeApi";
import { reportFault } from "../../lib/notify";
import { openExternalUrl } from "../../lib/openExternalUrl";
import { useTranslations } from "use-intl";

export function WorkflowAssets({
  workflowId,
  readOnly,
}: {
  workflowId: string;
  readOnly: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [files, setFiles] = useState<Document[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const versionUploadRef = useRef<HTMLInputElement>(null);
  const versionUploadTarget = useRef<Document | null>(null);

  const reload = async (): Promise<void> => {
    setFiles(await listWorkflowAssets(workflowId));
  };

  useEffect(() => {
    // Guard against out-of-order responses when the user switches workflows
    // quickly, and surface failures instead of rendering an empty list.
    let cancelled = false;
    listWorkflowAssets(workflowId)
      .then((rows) => {
        if (!cancelled) {
          setFiles(rows);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setFiles([]);
          setError(
            reportFault(reason, {
              fallback: clientTranslator()("word.loadWorkflowFilesFailed"),
              operation: "workflows.run",
            }).message,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const outcomes = await uploadWorkflowAssets(workflowId, [file]);
      await reload();
      setError(
        outcomes.some((outcome) => outcome.status === "error")
          ? clientTranslator()("word.fileUploadFailed", { name: file.name })
          : null,
      );
    } catch (reason) {
      setError(
        reportFault(reason, {
          fallback: clientTranslator()("word.uploadFileFailed"),
          operation: "workflows.run",
        }).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadVersion = async (file: File): Promise<void> => {
    if (!versionUploadTarget.current) return;
    setBusy(true);
    try {
      await uploadWorkflowAssetVersion(versionUploadTarget.current.id, file);
      await reload();
      setError(null);
    } catch (reason) {
      setError(
        reportFault(reason, {
          fallback: clientTranslator()("word.uploadVersionFailed"),
          operation: "workflows.run",
        }).message,
      );
    } finally {
      versionUploadTarget.current = null;
      setBusy(false);
    }
  };

  return (
    <section className="mt-2 shrink-0 rounded-xl bg-surface-sheet p-3 text-xs shadow-elev-sheet">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium text-gray-700">{t("word.assets")}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {t("word.availableWhenThisWorkflowRuns")}
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => uploadRef.current?.click()}
            className="rounded-full border border-gray-200 bg-surface-sheet px-2.5 py-1 text-[11px] text-gray-600 disabled:opacity-50"
          >
            {t("word.addFile")}
          </button>
        )}
      </div>
      <input
        ref={uploadRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
      <input
        ref={versionUploadRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadVersion(file);
        }}
      />
      {files.length === 0 ? (
        <p className="mt-2 text-[11px] text-gray-400">{t("word.noAssets")}</p>
      ) : (
        <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 rounded-md bg-surface-field px-2 py-1.5"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-gray-600">{file.filename}</span>
                {isTrainingHeld(file) && (
                  <TrainingHeldNoteUI className="text-[10px]" />
                )}
              </span>
              {!isTrainingHeld(file) && (
              <button
                type="button"
                onClick={() =>
                  void getWorkflowAssetUrl(file.id)
                    .then(({ url }) => openExternalUrl(url))
                    .catch((reason: unknown) =>
                      setError(
                        reportFault(reason, {
                          fallback: clientTranslator()("word.openFileFailed"),
                          operation: "workflows.run",
                        }).message,
                      ),
                    )
                }
                className="text-[10px] text-gray-500"
              >
                {t("word.download")}
              </button>
              )}
              {!readOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      versionUploadTarget.current = file;
                      versionUploadRef.current?.click();
                    }}
                    className="text-[10px] text-gray-500"
                  >
                    {t("word.uploadNewVersion")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void deleteWorkflowAsset(workflowId, file.id)
                        .then(reload)
                        .catch((reason: unknown) =>
                          setError(
                            reportFault(reason, {
                              fallback:
                                clientTranslator()("word.deleteFileFailed"),
                              operation: "workflows.run",
                            }).message,
                          ),
                        )
                    }
                    className="text-[10px] text-red-500"
                  >
                    {t("word.delete")}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

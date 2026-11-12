"use client";

import { PillButtonUI } from "@mike/ui";
import type { MemoryAutosaveStatus } from "./useMemoryAutosave";
import type { MemoryCurrent } from "@/app/lib/mikeApi";
import { useTranslations } from "next-intl";

export function memoryActivityLabel(memory: MemoryCurrent) {
  if (memory.status === "scheduled") return "Memory review scheduled";
  if (memory.status === "processing") return "Updating memory…";
  return null;
}

export function MemoryConflictNotice({
  project = false,
  onReload,
  onKeepDraft,
}: {
  project?: boolean;
  onReload: () => void;
  onKeepDraft: () => void;
}) {
  const t = useTranslations();
  return (
    <div
      className="rounded-xl bg-warning-surface px-4 py-3 text-sm text-warning"
      role="alert"
    >
      <p className="font-medium">
        {project ? t("memory.projectMemory") : t("memory.memory")} {t("memory.changedWhileYouWereEditing")}
      </p>
      <p className="mt-1 text-xs text-warning">
        {t("memory.reloadWhatIsSavedNowOr")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <PillButtonUI tone="white" size="sm" onClick={onReload}>
          {t("memory.reloadLatest")}
        </PillButtonUI>
        <PillButtonUI tone="black" size="sm" onClick={onKeepDraft}>
          {t("memory.keepMyDraft")}
        </PillButtonUI>
      </div>
    </div>
  );
}

export function MemorySaveStatus({
  error,
  status,
  onRetry,
  compact = false,
}: {
  error: string | null;
  status: MemoryAutosaveStatus;
  onRetry: () => void;
  compact?: boolean;
}) {
  const t = useTranslations();
  if (error) {
    return (
      <span
        className={`inline-flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}
      >
        <span className="text-red-600" role="alert">
          {error}
        </span>
        <button
          type="button"
          className="font-medium text-gray-700 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          onClick={onRetry}
        >
          {t("memory.retry")}
        </button>
      </span>
    );
  }
  if (status === "idle") return null;
  return (
    <span className="text-xs text-gray-500" role="status" aria-live="polite">
      {status === "saving" ? t("memory.saving") : t("memory.saved")}
    </span>
  );
}

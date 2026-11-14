"use client";

import type { ReactNode } from "react";
import { AttachmentChipUI } from "@mike/ui";
import { FileTypeIcon } from "@/app/components/shared/FileTypeIcon";
import { useTranslations } from "next-intl";

/**
 * A document attached to something about to be sent, as a removable label:
 * the chat composer's attachments and a playbook run's documents. It is the
 * composer's soft sheet with the icon of its file type.
 */
export function DocumentPill({
  filename,
  fileType,
  icon,
  status,
  tone = "default",
  loading = false,
  onOpen,
  onRemove,
  removeDisabled = false,
}: {
  filename: string;
  /** A file type or a filename; defaults to `filename`. */
  fileType?: string | null;
  /** Shown in place of the file icon, such as a progress spinner. */
  icon?: ReactNode;
  /** Read after the name by assistive technology, such as "Started". */
  status?: string;
  tone?: "default" | "error";
  /**
   * Still uploading: the file icon is faded and a spinner takes the remove
   * button's place, so the pill keeps the same size when it finishes.
   */
  loading?: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const t = useTranslations();
  return (
    <AttachmentChipUI
      name={filename}
      icon={icon ?? <FileTypeIcon fileType={fileType ?? filename} />}
      status={status}
      tone={tone}
      loading={loading}
      onOpen={onOpen}
      openLabel={t("shared.documentPill.openFilename", { filename })}
      onRemove={onRemove}
      removeLabel={t("shared.documentPill.removeFilename", { filename })}
      removeDisabled={removeDisabled}
    />
  );
}

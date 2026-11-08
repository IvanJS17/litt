"use client";

// LiTT: the line a draft playbook shows above its views. A draft cannot be
// used in a review; an editor marks it ready after a confirmation that counts
// the rules without backing and the unverified legal references.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import type { PlaybookContent } from "@/app/lib/mikeApi";
import { provenanceCounts } from "./usePlaybookProvenance";

export function PlaybookDraftBanner({
  content,
  canEdit,
  disabled,
  onMarkReady,
}: {
  content: PlaybookContent;
  /** Only an editor or owner marks it ready; anyone else reads the line. */
  canEdit: boolean;
  disabled: boolean;
  /** Resolves true once marked ready; on false the caller has said why. */
  onMarkReady: () => Promise<boolean>;
}) {
  const t = useTranslations("playbooks.draft");
  const tCommon = useTranslations("common");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const counts = provenanceCounts(content);

  async function markReady() {
    setSaving(true);
    try {
      if (await onMarkReady()) setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="note"
      className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-700 md:mx-6.5"
    >
      <p className="min-w-0 flex-1 basis-64">{t("banner")}</p>
      {canEdit && (
        <PillButtonUI
          tone="black"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          {t("markReady")}
        </PillButtonUI>
      )}
      <ConfirmPopup
        open={confirming}
        title={t("confirmTitle")}
        message={t("confirmMessage", counts)}
        confirmLabel={t("markReady")}
        cancelLabel={tCommon("cancel")}
        confirmStatus={saving ? "loading" : "idle"}
        onConfirm={() => void markReady()}
        onCancel={() => {
          if (!saving) setConfirming(false);
        }}
      />
    </div>
  );
}

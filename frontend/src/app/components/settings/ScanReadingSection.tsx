"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MfaVerificationPopup } from "@/app/components/popups/MfaVerificationPopup";
import { ScanReadingCard } from "@/app/components/settings/ScanReadingCard";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { isMfaRequiredError } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/** A person's own scan reading: their LandingAI key and whether it is on. */
export function ScanReadingSection() {
  const t = useTranslations();
  const { profile, updateApiKey, updateApiKeyEnabled } = useUserProfile();
  const [busy, setBusy] = useState(false);
  const [pendingMfa, setPendingMfa] = useState<boolean | null>(null);
  const key = profile?.apiKeys.landingai;
  const hasSavedKey = key?.source === "user";

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      if (!(await updateApiKeyEnabled("landingai", enabled)))
        notifyError(new Error("scan_reading_toggle"), {
          action: t("settings.scanReading.couldNotUpdate"),
          onRetry: () => void toggle(enabled),
        });
    } catch (error) {
      if (isMfaRequiredError(error)) setPendingMfa(enabled);
      else
        notifyError(error, {
          action: t("settings.scanReading.couldNotUpdate"),
          onRetry: () => void toggle(enabled),
        });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScanReadingCard
        loading={!profile}
        hasSavedKey={hasSavedKey}
        enabled={hasSavedKey && key?.enabled !== false}
        busy={busy}
        onToggle={(enabled) => void toggle(enabled)}
        onSaveKey={(value) => updateApiKey("landingai", value.trim() || null)}
        onRemoveKey={() => updateApiKey("landingai", null)}
      />
      <MfaVerificationPopup
        open={pendingMfa !== null}
        onCancel={() => setPendingMfa(null)}
        onVerified={() => {
          const enabled = pendingMfa;
          setPendingMfa(null);
          if (enabled !== null) void toggle(enabled);
        }}
      />
    </>
  );
}

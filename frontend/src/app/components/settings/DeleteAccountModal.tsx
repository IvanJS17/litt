"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { FieldLabel } from "@/app/components/ui/form-field";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import { PillButtonUI } from "@mike/ui";
import {
  MfaVerificationPopup,
  needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { isMfaRequiredError } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { saveUserExport } from "@/app/lib/userExportDownload";
import { useTranslations } from "next-intl";

/**
 * "Delete my account", before anything is deleted: offer the personal data
 * download, then ask for the account's email. Progress and the receipt are
 * shown by /account-deleted, which survives the session being revoked.
 */
export function DeleteAccountModal({
  open,
  email,
  deleting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  email: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();
  const [step, setStep] = useState<"download" | "confirm">("download");
  const [typed, setTyped] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  // Start over whenever the dialog closes, including when the parent closes
  // it after a failed deletion: Retry must never reopen it pre-confirmed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setStep("download");
      setTyped("");
    }
  }
  const matches =
    typed.trim().toLowerCase() === email.trim().toLowerCase() && !!email;

  const close = () => {
    if (deleting) return;
    onCancel();
  };

  const download = async () => {
    setDownloading(true);
    try {
      // Exports require a verified second factor when one is enrolled.
      if (await needsMfaVerification()) {
        setMfaOpen(true);
        return;
      }
      await saveUserExport(
        "account",
        { workspace: "personal" },
        "litt-account-export.json",
      );
    } catch (error) {
      if (isMfaRequiredError(error)) {
        setMfaOpen(true);
        return;
      }
      notifyError(error, {
        action: t("settings.deleteAccountModal.actions.downloadYourData"),
        onRetry: () => void download(),
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        breadcrumbs={[t("settings.layout.tab.account"), t("settings.deleteAccountModal.deleteAccount")]}
        size="sm"
        className="h-auto"
        cancelAction={{ label: t("common.cancel"), onClick: close, disabled: deleting }}
        primaryAction={
          step === "download"
            ? { label: t("common.continue"), onClick: () => setStep("confirm") }
            : {
                label: t("settings.deleteAccountModal.deleteMyAccount"),
                variant: "danger",
                disabled: !matches || deleting,
                onClick: onConfirm,
              }
        }
      >
        {step === "download" ? (
          <div className="space-y-4 pb-5 text-sm leading-relaxed text-gray-600">
            <p>
              {t("settings.deleteAccountModal.beforeYouDeleteYourAccountYou")}
            </p>
            <PillButtonUI
              tone="white"
              size="sm"
              onClick={() => void download()}
              loading={downloading}
              disabled={downloading}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              {t("settings.deleteAccountModal.downloadMyData")}
            </PillButtonUI>
          </div>
        ) : (
          <div className="space-y-4 pb-5 text-sm leading-relaxed text-gray-600">
            <p>
              {t("settings.deleteAccountModal.yourPersonalDocumentsChatsMemoryPreferences")}
            </p>
            <div className="space-y-1">
              <FieldLabel htmlFor="delete-account-email">
                {t("settings.deleteAccountModal.typeYourEmailToConfirm")}
              </FieldLabel>
              <SettingsTextInput
                id="delete-account-email"
                type="email"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={email}
              />
            </div>
          </div>
        )}
      </Modal>
      <MfaVerificationPopup
        open={mfaOpen}
        onCancel={() => setMfaOpen(false)}
        onVerified={() => {
          setMfaOpen(false);
          void download();
        }}
        title={t("settings.deleteAccountModal.twoFactorVerificationRequired")}
        message={t("settings.deleteAccountModal.downloadingYourDataIsSensitiveEnter")}
      />
    </>
  );
}

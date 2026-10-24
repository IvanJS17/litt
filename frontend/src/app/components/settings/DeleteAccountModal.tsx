"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { FieldLabel } from "@/app/components/ui/form-field";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import {
  MfaVerificationPopup,
  needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { isMfaRequiredError } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { runUserExport } from "@/app/lib/userExportDownload";

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
      await runUserExport(
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
        action: "download your data",
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
        breadcrumbs={["Account", "Delete account"]}
        size="sm"
        className="h-auto"
        cancelAction={{ label: "Cancel", onClick: close, disabled: deleting }}
        primaryAction={
          step === "download"
            ? { label: "Continue", onClick: () => setStep("confirm") }
            : {
                label: "Delete my account",
                variant: "danger",
                disabled: !matches || deleting,
                onClick: onConfirm,
              }
        }
      >
        {step === "download" ? (
          <div className="space-y-4 pb-5 text-sm leading-relaxed text-gray-600">
            <p>
              Before you delete your account, you can download a copy of your
              personal data.
            </p>
            <PillButtonUI
              tone="white"
              size="sm"
              onClick={() => void download()}
              loading={downloading}
              disabled={downloading}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              Download my data
            </PillButtonUI>
          </div>
        ) : (
          <div className="space-y-4 pb-5 text-sm leading-relaxed text-gray-600">
            <p>
              Your personal documents, chats, memory, preferences, connections,
              AI keys and profile are deleted now. Work you created in your
              firm&rsquo;s matters, audit history and AI evidence stay with the
              firm and will show &ldquo;Deleted user&rdquo;. Backups are deleted
              within 30 days.
            </p>
            <div className="space-y-1">
              <FieldLabel htmlFor="delete-account-email">
                Type your email to confirm
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
        title="Two-factor verification required"
        message="Downloading your data is sensitive. Enter a code from your authenticator app to continue."
      />
    </>
  );
}

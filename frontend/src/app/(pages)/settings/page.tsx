"use client";

import { ProfilePhotoSettings } from "@/app/components/settings/ProfilePhotoSettings";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { PillButtonUI, GlassCardUI } from "@mike/ui";
import { Modal } from "@/app/components/modals/Modal";
import { FieldLabel } from "@/app/components/ui/form-field";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { DeleteAccountModal } from "@/app/components/settings/DeleteAccountModal";
import { ACCOUNT_DELETION_TOKEN_KEY } from "@/app/lib/accountDeletion";
import {
  MfaVerificationPopup,
  needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { deleteAccount, isMfaRequiredError } from "@/app/lib/mikeApi";
import { authMessages, authSentence } from "@/app/lib/authMessages";
import { clientTranslator } from "@mike/client";
import {
  describeError,
  notifyError,
} from "@/app/lib/userFacingError";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SourceCodeLink } from "@/app/components/shared/SourceCodeLink";
import { useTranslations } from "next-intl";

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
  if (isDev) console.log(...args);
};

interface EmailWarning {
  title: string;
  message: string;
}

/** Keyed by the `code` GoTrue returns from `PATCH /api/auth/email`. */
// One auth message source (authMessages.ts); only the email-field wording
// differs here, because a validation failure on this screen can only mean
// the address itself.
const EMAIL_ERROR_MESSAGES = authMessages({
  validation_failed: authSentence("emailInvalid"),
  invalid_request: authSentence("emailInvalid"),
  reauthentication_needed: () =>
    clientTranslator()("settings.home.reauthenticateBeforeChangingEmail"),
});

const EMAIL_TAKEN_CODES = new Set(["email_exists", "user_already_exists"]);
const EMAIL_RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

/** Composes authenticated account settings, including profile-photo editing and account security controls. */
export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const { user, updateEmail } = useAuth();
  const { profile, updateDisplayName } = useUserProfile();
  const [displayName, setDisplayName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [saved, setSaved] = useState(false);
  const [email, setEmail] = useState("");
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailWarning, setEmailWarning] = useState<EmailWarning | null>(null);
  const [emailMfaOpen, setEmailMfaOpen] = useState(false);
  const [googleEmailModalOpen, setGoogleEmailModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [accountDeleteMfaOpen, setAccountDeleteMfaOpen] = useState(false);
  const requiresPasswordForEmailChange =
    user?.createdWithGoogle === true && profile?.passwordSet !== true;

  // Sync a profile that loads after mount, even while the name input is focused.
  // Otherwise an empty blur-autosave could overwrite the stored name.
  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
  }, [profile?.displayName]);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.pendingEmail || user.email);
    }
  }, [user?.email, user?.pendingEmail]);

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("emailChange") !==
        "processed" ||
      !user
    ) {
      return;
    }
    setEmailStatus(
      user.pendingEmail
        ? t("settings.home.oneConfirmationWasAcceptedConfirmTheEmail")
        : t("settings.home.emailUpdated"),
    );
    window.history.replaceState({}, "", "/settings");
  }, [user, t]);

  const handleDeleteAccount = async () => {
    devLog("[account/mfa] delete account requested");
    setIsDeleting(true);
    try {
      if (await needsMfaVerification()) {
        setDeleteConfirm(false);
        setAccountDeleteMfaOpen(true);
        setIsDeleting(false);
        return;
      }
      const { receipt_token } = await deleteAccount();
      // The session is revoked server-side; /account-deleted follows the
      // erasure with this token and signs out after showing the receipt.
      sessionStorage.setItem(ACCOUNT_DELETION_TOKEN_KEY, receipt_token);
      router.push("/account-deleted");
    } catch (error) {
      setIsDeleting(false);
      devLog("[account/mfa] delete account failed", {
        isMfaRequired: isMfaRequiredError(error),
        error,
      });
      if (isMfaRequiredError(error)) {
        setDeleteConfirm(false);
        setAccountDeleteMfaOpen(true);
        return;
      }
      setDeleteConfirm(false);
      notifyError(error, {
        action: t("settings.home.actions.deleteYourAccount"),
        // Retry re-opens the confirmation instead of deleting outright: a
        // button in a notice must never be the only thing between a stray
        // click and an irreversible account deletion.
        onRetry: () => setDeleteConfirm(true),
        supportNote: "Account deletion failed.",
      });
    }
  };

  const handleSaveEmail = async () => {
    if (requiresPasswordForEmailChange) {
      setGoogleEmailModalOpen(true);
      return;
    }
    const nextEmail = email.trim();
    if (!nextEmail || nextEmail === user?.email) return;

    devLog("[account/mfa] save email requested");
    setIsSavingEmail(true);
    setEmailStatus(null);
    setEmailWarning(null);
    try {
      if (await needsMfaVerification()) {
        setEmailMfaOpen(true);
        return;
      }

      const updatedUser = await updateEmail(nextEmail);
      const pendingEmail = updatedUser.pendingEmail;
      setEmail(pendingEmail || updatedUser.email);
      setEmailSaved(true);
      setEmailStatus(
        pendingEmail
          ? t("settings.home.confirmationSentToBoth", { pendingEmail, email: updatedUser.email })
          : t("settings.home.emailUpdated"),
      );
      setTimeout(() => setEmailSaved(false), 2000);
    } catch (error: unknown) {
      devLog("[account/mfa] save email failed", { error });
      // The backend passes GoTrue's `code` through, so the outcome is decided
      // by that code rather than by matching English in the message.
      const described = describeError(error, {
        action: t("settings.home.actions.updateYourEmail"),
        codeMessages: EMAIL_ERROR_MESSAGES,
        fallback: t("settings.home.unableToUpdateYourEmailTryAgain"),
      });

      if (described.code && EMAIL_TAKEN_CODES.has(described.code)) {
        setEmail(user?.pendingEmail || user?.email || "");
        setEmailWarning({
          title: t("settings.home.emailAlreadyRegistered"),
          message: t("settings.home.anAccountWithThisEmailAlready"),
        });
        return;
      }

      if (
        (described.code && EMAIL_RATE_LIMIT_CODES.has(described.code)) ||
        described.kind === "rate_limited"
      ) {
        setEmail(user?.pendingEmail || user?.email || "");
        setEmailWarning({
          title: t("settings.home.emailChangeUnavailable"),
          message:
            t("settings.home.youCantChangeYourEmailThis"),
        });
        return;
      }

      setEmailStatus(described.message);
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleSaveDisplayName = async () => {
    const nextName = displayName.trim();
    if (nextName === (profile?.displayName ?? "")) return;
    setIsSavingName(true);
    const success = await updateDisplayName(nextName);
    setIsSavingName(false);

    // A failure is reported once, by the profile context's notice (message,
    // Retry, support); the field shows no second status for it.
    if (success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-8">
      {/* Profile Settings */}
      <section className="space-y-3">
        <SettingsHeading id="profile">{t("settings.home.profile")}</SettingsHeading>
        <GlassCardUI>
          <SettingsRow layout="stacked">
            <div>
              <div className="flex items-start justify-between gap-3">
                <FieldLabel htmlFor="display-name">{t("settings.home.displayName")}</FieldLabel>
                <span
                  className="text-xs text-gray-400"
                  aria-live="polite"
                >
                  {isSavingName
                    ? t("settings.home.saving")
                    : saved
                      ? t("settings.home.saved")
                      : ""}
                </span>
              </div>
              <SettingsTextInput
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setSaved(false);
                }}
                onBlur={() => void handleSaveDisplayName()}
                placeholder={t("settings.home.enterYourName")}
              />
            </div>
          </SettingsRow>
          <ProfilePhotoSettings />
        </GlassCardUI>
      </section>

      {/* Email */}
      <section className="space-y-3">
        <SettingsHeading id="email">{t("settings.home.email")}</SettingsHeading>
        <GlassCardUI>
          <SettingsRow layout="stacked">
            <div className="space-y-2">
              <SettingsTextInput
                aria-label={t("settings.home.emailAddress")}
                type="email"
                value={email}
                disabled={requiresPasswordForEmailChange}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailStatus(null);
                  setEmailWarning(null);
                  setEmailSaved(false);
                }}
                placeholder={t("settings.home.enterYourEmail")}
              />
              {emailStatus ? (
                <p className="text-xs text-gray-500">{emailStatus}</p>
              ) : user.pendingEmail ? (
                <p className="text-xs text-gray-500">
                  {t("settings.home.pendingConfirmationPendingemail", { pendingEmail: user.pendingEmail })}
                </p>
              ) : null}
              {emailStatus && (
                <p className="text-xs text-gray-400">
                  {t("settings.home.currentEmailEmail", { email: user.email })}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveEmail}
                  disabled={
                    isSavingEmail ||
                    (!requiresPasswordForEmailChange &&
                      (!email.trim() ||
                        email.trim() === user.email ||
                        email.trim() === user.pendingEmail ||
                        emailSaved))
                  }
                  className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {requiresPasswordForEmailChange
                    ? t("settings.home.update")
                    : isSavingEmail
                      ? t("settings.home.saving")
                      : emailSaved
                        ? t("settings.home.saved")
                        : t("common.save")}
                </button>
              </div>
            </div>
          </SettingsRow>
        </GlassCardUI>
      </section>

      {/* Plan */}
      <section className="space-y-3">
        <SettingsHeading id="usage-plan">{t("settings.home.usagePlan")}</SettingsHeading>
        <GlassCardUI>
          <SettingsRow layout="stacked">
            <p className="text-base font-medium text-gray-500 capitalize">
              {profile?.tier || t("settings.home.free")}
            </p>
          </SettingsRow>
        </GlassCardUI>
      </section>

      {/* About: AGPL-3.0 §13 source offer for the running version */}
      <section className="space-y-3">
        <SettingsHeading id="acerca-de">{t("settings.home.acercaDe")}</SettingsHeading>
        <GlassCardUI>
          <SettingsRow>
            <div className="min-w-0">
              <SettingsLabel>{t("common.sourceCode.label")}</SettingsLabel>
              <SettingsDescription>
                {t("settings.home.littEsSoftwareLibreBajoLa")}
              </SettingsDescription>
            </div>
            <SourceCodeLink className="self-start sm:self-auto" />
          </SettingsRow>
        </GlassCardUI>
      </section>

      {/* Danger Zone */}
      <section className="space-y-3">
        <SettingsHeading id="danger-zone" tone="danger">{t("settings.home.dangerZone")}</SettingsHeading>
        <GlassCardUI>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>{t("settings.home.deleteAccount")}</SettingsLabel>
              <SettingsDescription>
                {t("settings.home.permanentlyDeleteYourAccountAndEverything")}
              </SettingsDescription>
            </div>
            <PillButtonUI
              tone="whiteDanger"
              size="sm"
              onClick={() => setDeleteConfirm(true)}
              disabled={isDeleting}
              loading={isDeleting}
              className="w-full shrink-0 sm:w-auto"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {t("settings.home.deleteAccount")}
            </PillButtonUI>
          </SettingsRow>
        </GlassCardUI>
      </section>
      <DeleteAccountModal
        open={deleteConfirm}
        email={user.email}
        deleting={isDeleting}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={() => void handleDeleteAccount()}
      />
      <WarningPopup
        open={!!emailWarning}
        title={emailWarning?.title}
        message={emailWarning?.message}
        onClose={() => setEmailWarning(null)}
      />
      <Modal
        open={googleEmailModalOpen}
        onClose={() => setGoogleEmailModalOpen(false)}
        breadcrumbs={[t("settings.map.tab.account.title"), t("settings.home.changeEmail")]}
        size="sm"
        className="h-auto"
        primaryAction={{
          label: t("settings.home.goToSecurity"),
          onClick: () => {
            setGoogleEmailModalOpen(false);
            router.push("/settings/security");
          },
        }}
      >
        <p className="pb-5 text-sm leading-relaxed text-gray-600">
          {t("settings.home.yourAccountWasCreatedWithGoogle")}
        </p>
      </Modal>
      <MfaVerificationPopup
        open={accountDeleteMfaOpen}
        onCancel={() => setAccountDeleteMfaOpen(false)}
        onVerified={() => {
          devLog("[account/mfa] account delete verification callback");
          setAccountDeleteMfaOpen(false);
          void handleDeleteAccount();
        }}
        title={t("settings.home.twoFactorVerificationRequired")}
        message={t("settings.home.accountDeletionIsSensitiveEnterA")}
      />
      <MfaVerificationPopup
        open={emailMfaOpen}
        onCancel={() => setEmailMfaOpen(false)}
        onVerified={() => {
          devLog("[account/mfa] email verification callback");
          setEmailMfaOpen(false);
          void handleSaveEmail();
        }}
        title={t("settings.home.twoFactorVerificationRequired")}
        message={t("settings.home.emailChangesAreSensitiveEnterA")}
      />
    </div>
  );
}

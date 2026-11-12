"use client";

import { useState } from "react";
import { authInputUIClassName, InputUI, PillButtonUI, GlassCardUI } from "@mike/ui";
import {
  MIN_PASSWORD_LENGTH,
  isPasswordTooLong,
} from "@/app/components/auth/passwordPolicy";
import {
  authSentence,
  authSentenceText,
  authMessages,
} from "@/app/lib/authMessages";
import { Modal } from "@/app/components/modals/Modal";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { requestPasswordReset } from "@/app/lib/authApi";
import {
  UserVisibleError,
  describeError,
  supportMailtoFor,
  type UserFacingError,
} from "@/app/lib/userFacingError";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsRow } from "./SettingsRow";
import { SettingsDescription, SettingsLabel } from "./SettingsText";
import { FieldLabel } from "@/app/components/ui/form-field";
import { useTranslations } from "next-intl";
import { clientTranslator } from "@mike/client";

/** The shared auth table with this section's deltas, keyed by the `code`
 *  GoTrue returns from `PATCH /api/auth/password`. */
const PASSWORD_ERROR_MESSAGES = authMessages({
  validation_failed: authSentence("passwordLength"),
  invalid_request: authSentence("passwordLength"),
  reauthentication_needed: () =>
    clientTranslator()("settings.passwordSettingsSection.reauthenticateBeforeSettingAPassword"),
});

export function PasswordSettingsSection() {
  const t = useTranslations();
  const { user, setPassword } = useAuth();
  const { profile, syncPasswordSet } = useUserProfile();
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSetError, setPasswordSetError] =
    useState<UserFacingError | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordResetSending, setPasswordResetSending] = useState(false);

  const needsInitialPassword =
    user?.createdWithGoogle === true && profile?.passwordSet !== true;

  async function addPassword() {
    setPasswordSetError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordSetError(localPasswordError(authSentenceText("passwordTooShort")));
      return;
    }
    if (isPasswordTooLong(password)) {
      setPasswordSetError(localPasswordError(authSentenceText("passwordTooLong")));
      return;
    }
    if (password !== confirmPassword) {
      setPasswordSetError(localPasswordError(t("settings.passwordSettingsSection.theTwoPasswordsDontMatch")));
      return;
    }

    setPasswordSaving(true);
    try {
      await setPassword(password);
      const synced = await syncPasswordSet();
      if (!synced) {
        throw new UserVisibleError(
          t("settings.passwordSettingsSection.passwordSetButNotRefreshed"),
        );
      }
      setPasswordValue("");
      setConfirmPassword("");
      setSetPasswordOpen(false);
      setPasswordStatus(t("settings.passwordSettingsSection.passwordAddedToYourAccount"));
    } catch (error) {
      // GoTrue's own wording ("Password should be at least 6 characters")
      // contradicts Mike's policy, so the code decides the text instead.
      setPasswordSetError(
        describeError(error, {
          action: t("settings.passwordSettingsSection.actions.setYourPassword"),
          codeMessages: PASSWORD_ERROR_MESSAGES,
          fallback: t("settings.passwordSettingsSection.unableToSetYourPasswordTryAgain"),
        }),
      );
    } finally {
      setPasswordSaving(false);
    }
  }

  async function sendPasswordReset() {
    if (!user?.email || passwordResetSending) return;
    setPasswordResetSending(true);
    setPasswordStatus(null);
    try {
      await requestPasswordReset(user.email);
      setPasswordStatus(t("settings.passwordSettingsSection.passwordResetInstructionsSent", { email: user.email }));
    } catch (error) {
      setPasswordStatus(
        describeError(error, {
          action: t("settings.passwordSettingsSection.actions.sendTheResetEmail"),
          codeMessages: PASSWORD_ERROR_MESSAGES,
          fallback: t("settings.passwordSettingsSection.unableToSendAResetEmail"),
        }).message,
      );
    } finally {
      setPasswordResetSending(false);
    }
  }

  /** A failure the form found itself; the text is already user-facing. */
  function localPasswordError(message: string): UserFacingError {
    return describeError(new UserVisibleError(message, { kind: "validation" }), {
      action: t("settings.passwordSettingsSection.actions.setYourPassword"),
    });
  }

  function closeSetPassword() {
    if (passwordSaving) return;
    setSetPasswordOpen(false);
    setPasswordSetError(null);
    setPasswordValue("");
    setConfirmPassword("");
  }

  return (
    <section className="space-y-3">
      <SettingsHeading id="password">{t("settings.passwordSettingsSection.password")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow>
          <div className="min-w-0 space-y-1">
            <SettingsLabel>
              {needsInitialPassword ? t("settings.passwordSettingsSection.setPassword") : t("settings.passwordSettingsSection.resetPassword")}
            </SettingsLabel>
            <SettingsDescription>
              {needsInitialPassword
                ? t("settings.passwordSettingsSection.addAPasswordToSignIn")
                : t("settings.passwordSettingsSection.sendASecurePasswordResetLink", { email: user?.email ?? "" })}
            </SettingsDescription>
            {passwordStatus && (
              <p className="text-xs text-gray-500">{passwordStatus}</p>
            )}
          </div>
          <PillButtonUI
            tone="black"
            size="sm"
            onClick={() =>
              needsInitialPassword
                ? setSetPasswordOpen(true)
                : void sendPasswordReset()
            }
            disabled={passwordResetSending || !user?.email || passwordSaving}
            className="shrink-0"
          >
            {needsInitialPassword
              ? t("settings.passwordSettingsSection.setPassword")
              : passwordResetSending
                ? t("settings.passwordSettingsSection.sending")
                : t("settings.passwordSettingsSection.sendResetEmail")}
          </PillButtonUI>
        </SettingsRow>
      </GlassCardUI>

      <Modal
        open={setPasswordOpen}
        onClose={closeSetPassword}
        breadcrumbs={[t("settings.layout.tab.security"), t("settings.passwordSettingsSection.setPassword")]}
        size="sm"
        className="h-auto"
        cancelAction={{
          label: t("common.cancel"),
          onClick: closeSetPassword,
          disabled: passwordSaving,
        }}
        primaryAction={{
          label: passwordSaving ? t("settings.passwordSettingsSection.setting") : t("settings.passwordSettingsSection.setPassword"),
          onClick: () => void addPassword(),
          disabled: passwordSaving || !password || !confirmPassword,
        }}
      >
        <div className="space-y-4 pb-5">
          <p className="text-sm text-gray-500">
            {t("settings.passwordSettingsSection.useAtLeastMinPasswordLength", { MIN_PASSWORD_LENGTH })}
          </p>
          <div>
            <FieldLabel htmlFor="new-account-password">{t("settings.passwordSettingsSection.password")}</FieldLabel>
            <InputUI
              id="new-account-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPasswordValue(event.target.value)}
              className={`w-full ${authInputUIClassName}`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="confirm-account-password">
              {t("settings.passwordSettingsSection.confirmPassword")}
            </FieldLabel>
            <InputUI
              id="confirm-account-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={`w-full ${authInputUIClassName}`}
            />
          </div>
          {passwordSetError && (
            <p className="text-sm text-red-600" role="alert">
              {passwordSetError.message}
              {passwordSetError.supportable && (
                <a
                  href={supportMailtoFor(
                    passwordSetError,
                    t("settings.passwordSettingsSection.failedToSetAnAccountPassword"),
                  )}
                  className="ml-2 underline underline-offset-2"
                >
                  {t("settings.passwordSettingsSection.contactSupport")}
                </a>
              )}
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}

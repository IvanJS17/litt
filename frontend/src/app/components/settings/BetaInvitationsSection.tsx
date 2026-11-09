"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsLabel, SettingsDescription } from "@/app/components/settings/SettingsText";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import {
  createPlatformInvitation,
  deletePlatformInvitation,
  listPlatformInvitations,
  type PlatformInvitation,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

/** Platform administrators: invite someone to the beta to open their own firm. */
export function BetaInvitationsSection() {
  const t = useTranslations();
  const [invitations, setInvitations] = useState<PlatformInvitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toCancel, setToCancel] = useState<PlatformInvitation | null>(null);

  const load = useCallback(async () => {
    try {
      setInvitations(await listPlatformInvitations());
    } catch (err) {
      setError(userFacingApiError(err, t("access.beta.loadError")));
      setInvitations((current) => current ?? []);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createPlatformInvitation(trimmed);
      setNotice(t(created.email_sent ? "access.invite.sent" : "access.invite.notSent"));
      setEmail("");
    } catch (err) {
      setError(userFacingApiError(err, t("access.beta.loadError")));
    } finally {
      setBusy(false);
    }
    await load();
  }

  async function cancel() {
    const target = toCancel;
    if (!target) return;
    setToCancel(null);
    setError(null);
    setNotice(null);
    try {
      await deletePlatformInvitation(target.id);
    } catch (err) {
      setError(userFacingApiError(err, t("access.beta.loadError")));
    }
    await load();
  }

  const statusOf = (invitation: PlatformInvitation) =>
    invitation.status === "pending" && new Date(invitation.expires_at) < new Date()
      ? "expired"
      : invitation.status;

  return (
    <section aria-labelledby="beta-invitations-heading" className="space-y-4">
      <div>
        <SettingsHeading id="beta-invitations-heading">{t("access.beta.heading")}</SettingsHeading>
        <SettingsDescription>{t("access.beta.hint")}</SettingsDescription>
      </div>

      <form onSubmit={(event) => void invite(event)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1.5 basis-64">
          <label htmlFor="beta-invite-email">
            <SettingsLabel>{t("access.beta.emailLabel")}</SettingsLabel>
          </label>
          <SettingsTextInput
            id="beta-invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <PillButtonUI type="submit" tone="black" size="normal" disabled={busy || !email.trim()}>
          {busy ? t("access.beta.inviting") : t("access.beta.invite")}
        </PillButtonUI>
      </form>

      {notice && (
        <p role="status" className="text-sm text-gray-600">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {invitations === null ? (
        <div aria-busy="true" className="space-y-2">
          {[1, 2].map((placeholder) => (
            <span key={placeholder} className="block h-14 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : invitations.length === 0 ? (
        <SettingsDescription>{t("access.beta.empty")}</SettingsDescription>
      ) : (
        <ul className="space-y-2">
          {invitations.map((invitation) => {
            const status = statusOf(invitation);
            return (
              <li key={invitation.id}>
                <GlassCardUI>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="break-all text-sm font-medium text-gray-900">{invitation.email}</p>
                      <p className="text-sm text-gray-500">{t(`access.beta.status.${status}`)}</p>
                      <p className="text-sm text-gray-500">
                        {t("access.beta.colExpires")}:{" "}
                        {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    {invitation.status === "pending" && (
                      <PillButtonUI
                        type="button"
                        tone="white"
                        size="sm"
                        onClick={() => setToCancel(invitation)}
                      >
                        {t("access.beta.cancel")}
                      </PillButtonUI>
                    )}
                  </div>
                </GlassCardUI>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmPopup
        open={toCancel !== null}
        title={t("access.beta.cancelTitle")}
        message={toCancel ? t("access.beta.cancelBody", { email: toCancel.email }) : ""}
        confirmLabel={t("access.beta.cancel")}
        confirmVariant="danger"
        cancelLabel={t("access.beta.keep")}
        onConfirm={() => void cancel()}
        onCancel={() => setToCancel(null)}
      />
    </section>
  );
}

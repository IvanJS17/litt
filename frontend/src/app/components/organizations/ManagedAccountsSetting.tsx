"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import {
  MfaVerificationPopup,
} from "@/app/components/popups/MfaVerificationPopup";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { isMfaRequiredError, setOrgManagedAccounts, type Org } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/**
 * "Firm-managed accounts" (docs/managed-accounts.md): when on, the accounts
 * this firm's invitation created have no personal workspace. Drawn for the
 * organization's owners and admins; the server refuses anyone else.
 */
export function ManagedAccountsSetting({
  org,
  setOrg,
}: {
  org: Org;
  setOrg: (org: Org) => void;
}) {
  const t = useTranslations();
  const { refreshOrganizations } = useWorkspace();
  const [saving, setSaving] = useState(false);
  // A change the server asked a second factor for, to send again after it.
  const [pendingMfa, setPendingMfa] = useState<boolean | null>(null);
  const enabled = org.managed_accounts === true;

  async function save(next: boolean) {
    setSaving(true);
    try {
      const saved = await setOrgManagedAccounts(org.id, next);
      setOrg({ ...org, managed_accounts: saved.managed_accounts });
      void refreshOrganizations();
    } catch (error) {
      if (isMfaRequiredError(error)) setPendingMfa(next);
      else
        notifyError(error, {
          action: t("orgSettings.managedAccounts.label"),
          onRetry: () => void save(next),
        });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="org-managed-accounts" className="space-y-3">
      <SettingsHeading id="org-managed-accounts">
        {t("orgSettings.managedAccounts.label")}
      </SettingsHeading>
      <GlassCardUI>
        <SettingsRow>
          <div className="space-y-1">
            <SettingsLabel>{t("orgSettings.managedAccounts.label")}</SettingsLabel>
            <SettingsDescription>
              {t("orgSettings.managedAccounts.help", { firm: org.name })}
            </SettingsDescription>
          </div>
          <ToggleSwitchUI
            checked={enabled}
            aria-label={t("orgSettings.managedAccounts.label")}
            disabled={saving}
            onCheckedChange={(checked) => void save(checked)}
            className="shrink-0"
          />
        </SettingsRow>
      </GlassCardUI>
      <MfaVerificationPopup
        open={pendingMfa !== null}
        onCancel={() => setPendingMfa(null)}
        onVerified={() => {
          const next = pendingMfa;
          setPendingMfa(null);
          if (next !== null) void save(next);
        }}
        title={t("organizations.organizationPrivacyData.twoFactorVerificationRequired")}
        message={t("organizations.organizationPrivacyData.thisSettingIsSensitiveEnterA")}
      />
    </section>
  );
}

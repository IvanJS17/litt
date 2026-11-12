"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listDeletedOrganizations,
  restoreOrganization,
  isMfaRequiredError,
  type DeletedOrganization,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  MfaVerificationPopup,
  needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { useTranslations } from "next-intl";

export function DeletedOrganizations({
  onRestored,
}: {
  onRestored: () => Promise<void>;
}) {
  const t = useTranslations();
  const { refreshOrganizations } = useWorkspace();
  const [orgs, setOrgs] = useState<DeletedOrganization[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mfaOrg, setMfaOrg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setOrgs(await listDeletedOrganizations());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      if (await needsMfaVerification()) {
        setMfaOrg(id);
        return;
      }
      await restoreOrganization(id);
      setOrgs((current) => current?.filter((org) => org.id !== id) ?? []);
    } catch (err) {
      if (isMfaRequiredError(err)) setMfaOrg(id);
      else
        setError(
          userFacingApiError(err, t("organizations.deletedOrganizations.couldNotRestoreTheOrganization")),
        );
      return;
    } finally {
      setBusy(null);
    }
    // A refresh failure must not report a successful restore as a failed one.
    await Promise.allSettled([load(), onRestored(), refreshOrganizations()]);
  }

  if (orgs?.length === 0 && !loadError) return null;
  return (
    <section
      aria-labelledby="deleted-organizations-heading"
      className="space-y-3"
    >
      <SettingsHeading id="deleted-organizations-heading">
        {t("organizations.deletedOrganizations.recentlyDeleted")}
      </SettingsHeading>
      <SettingsDescription>
        {t("organizations.deletedOrganizations.ownersCanRestoreAnOrganizationWithin")}
      </SettingsDescription>
      {loadError ? (
        <PillButtonUI tone="white" size="sm" onClick={() => void load()}>
          {t("organizations.deletedOrganizations.retryDeletedOrganizations")}
        </PillButtonUI>
      ) : orgs === null ? (
        <div
          aria-label={t("organizations.deletedOrganizations.loadingDeletedOrganizations")}
          aria-busy="true"
          className="h-16 animate-pulse rounded-lg bg-gray-200"
        />
      ) : (
        <GlassCardUI>
          {orgs.map((org) => (
            <SettingsRow key={org.id}>
              <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                <SettingsLabel>{org.name}</SettingsLabel>
                <SettingsDescription>
                  {t("organizations.deletedOrganizations.recoverBefore")} {new Date(org.purge_after).toLocaleString()}.
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="black"
                size="sm"
                disabled={busy !== null}
                loading={busy === org.id}
                aria-label={t("organizations.deletedOrganizations.restoreName", { name: org.name })}
                onClick={() => void restore(org.id)}
              >
                {t("organizations.deletedOrganizations.restore")}
              </PillButtonUI>
            </SettingsRow>
          ))}
        </GlassCardUI>
      )}
      <MfaVerificationPopup
        open={mfaOrg !== null}
        onCancel={() => setMfaOrg(null)}
        onVerified={() => {
          const id = mfaOrg;
          setMfaOrg(null);
          if (id) void restore(id);
        }}
      />
      <WarningPopup
        open={error !== null}
        title={t("organizations.deletedOrganizations.restoreFailed")}
        message={error}
        onClose={() => setError(null)}
      />
    </section>
  );
}

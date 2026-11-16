"use client";

import { useEffect, useId, useState } from "react";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import { useTranslations } from "next-intl";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsLabel, SettingsNotice } from "@/app/components/settings/SettingsText";
import {
  getCitationCheckSetting,
  setCitationCheckEnabled,
  type CitationCheckSetting,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/**
 * «Verificar mis citas con TypeSafe»: the personal opt-out of the silent
 * citation check. The check is the platform's and on for everyone, so there is
 * no key and no activation dialog here; the switch only turns it off for this
 * person. Where the deployment does not run it, the card is not drawn at all.
 */
export function CitationCheckCard() {
  const t = useTranslations();
  const headingId = useId();
  const helpId = useId();
  const [setting, setSetting] = useState<CitationCheckSetting | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCitationCheckSetting().then(
      (value) => !cancelled && setSetting(value),
      // Nothing to show if the setting cannot be read: the check is silent.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!setting?.available) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      setSetting(await setCitationCheckEnabled(enabled));
    } catch (error) {
      notifyError(error, {
        action: t("settings.citationCheck.couldNotUpdate"),
        onRetry: () => void toggle(enabled),
      });
    } finally {
      setBusy(false);
    }
  };

  const label = t("settings.citationCheck.enable");
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <SettingsHeading id={headingId}>{t("settings.citationCheck.title")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow>
          <div className="min-w-0 space-y-2">
            <SettingsLabel>{label}</SettingsLabel>
            <SettingsNotice bodyId={helpId} entries={[{ icon: "send", label: t("settings.signals.thirdParty") }]}>
              {t("settings.citationCheck.help")}
            </SettingsNotice>
          </div>
          <ToggleSwitchUI
            checked={setting.enabled}
            disabled={busy}
            aria-busy={busy}
            aria-label={label}
            aria-describedby={helpId}
            onCheckedChange={(enabled) => void toggle(enabled)}
          />
        </SettingsRow>
      </GlassCardUI>
    </section>
  );
}

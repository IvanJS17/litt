"use client";

import { useState } from "react";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { userFacingApiError } from "@/app/lib/userFacingError";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { useTranslations } from "next-intl";

export default function AppearancePage() {
  const t = useTranslations();
  const { profile, updateDarkMode } = useUserProfile();
  const [savingDarkMode, setSavingDarkMode] = useState(false);
  const [darkModeError, setDarkModeError] = useState<string | null>(null);

  if (!profile) return null;

  const handleDarkModeToggle = async (enabled: boolean) => {
    if (savingDarkMode) return;
    setSavingDarkMode(true);
    setDarkModeError(null);
    try {
      await updateDarkMode(enabled);
    } catch (toggleError) {
      setDarkModeError(
        userFacingApiError(
          toggleError,
          "Could not update the appearance setting.",
        ),
      );
    } finally {
      setSavingDarkMode(false);
    }
  };

  return (
    <section className="space-y-3">
      <SettingsHeading id="appearance">{t("settings.appearance.appearance")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow>
          <div className="min-w-0 space-y-1">
            <SettingsLabel>{t("settings.appearance.darkMode")}</SettingsLabel>
            <SettingsDescription>
              {t("settings.appearance.useADarkerColorPaletteThroughout")}
            </SettingsDescription>
            {darkModeError && (
              <p role="alert" className="text-xs text-red-600">
                {darkModeError}
              </p>
            )}
          </div>
          <ToggleSwitchUI
            checked={profile.darkMode === true}
            disabled={savingDarkMode}
            aria-busy={savingDarkMode}
            aria-label={t("settings.appearance.darkMode")}
            onCheckedChange={(checked) => void handleDarkModeToggle(checked)}
          />
        </SettingsRow>
      </GlassCardUI>
    </section>
  );
}

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
import { cn } from "@/app/lib/utils";
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, type TextSize } from "@/app/lib/textSize";



export default function AppearancePage() {
  const t = useTranslations();
  const { profile, updateDarkMode, updateTextSize } = useUserProfile();
  const [savingDarkMode, setSavingDarkMode] = useState(false);
  const [darkModeError, setDarkModeError] = useState<string | null>(null);

  const [savingTextSize, setSavingTextSize] = useState(false);
  const [textSizeError, setTextSizeError] = useState<string | null>(null);

  if (!profile) return null;

  const handleTextSize = async (size: TextSize) => {
    if (savingTextSize || size === (profile.textSize ?? DEFAULT_TEXT_SIZE)) return;
    setSavingTextSize(true);
    setTextSizeError(null);
    try {
      await updateTextSize(size);
    } catch (changeError) {
      setTextSizeError(
        userFacingApiError(
          changeError,
          t("settings.appearance.couldNotUpdateTheAppearanceSetting"),
        ),
      );
    } finally {
      setSavingTextSize(false);
    }
  };
  const textSizeLabels: Record<TextSize, string> = {
    normal: t("settings.appearance.textSizeNormal"),
    large: t("settings.appearance.textSizeLarge"),
    xlarge: t("settings.appearance.textSizeXLarge"),
  };
  const currentTextSize = profile.textSize ?? DEFAULT_TEXT_SIZE;

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
          t("settings.appearance.couldNotUpdateTheAppearanceSetting"),
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
        <SettingsRow>
          <div id="text-size" className="min-w-0 space-y-1">
            <SettingsLabel>{t("settings.appearance.textSize")}</SettingsLabel>
            <SettingsDescription>
              {t("settings.appearance.textSizeHelp")}
            </SettingsDescription>
            {textSizeError && (
              <p role="alert" className="text-xs text-red-600">
                {textSizeError}
              </p>
            )}
          </div>
          <div
            role="radiogroup"
            aria-label={t("settings.appearance.textSize")}
            aria-busy={savingTextSize}
            className="flex w-full shrink-0 gap-1 rounded-lg border border-gray-200 p-1 sm:w-auto"
          >
            {TEXT_SIZES.map((size) => {
              const selected = size === currentTextSize;
              return (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={savingTextSize}
                  onClick={() => void handleTextSize(size)}
                  className={cn(
                    "min-h-9 flex-1 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default sm:flex-none",
                    selected
                      ? "bg-interactive text-interactive-foreground"
                      : "text-gray-700 hover:bg-app-surface-hover",
                  )}
                >
                  {textSizeLabels[size]}
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </GlassCardUI>
    </section>
  );
}

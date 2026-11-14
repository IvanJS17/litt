"use client";

import { useState } from "react";
import { useThemeChoice } from "@/app/hooks/useThemeChoice";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { userFacingApiError } from "@/app/lib/userFacingError";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { GlassCardUI, ThemeSegmentedUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, type TextSize } from "@/app/lib/textSize";



export default function AppearancePage() {
  const t = useTranslations();
  const { profile, updateTextSize } = useUserProfile();
  const themeChoice = useThemeChoice();

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

  return (
    <section className="space-y-3">
      <SettingsHeading id="appearance">{t("settings.appearance.appearance")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow>
          <div id="theme" className="min-w-0 space-y-1">
            <SettingsLabel>{t("settings.appearance.theme")}</SettingsLabel>
            <SettingsDescription>
              {t("settings.appearance.themeHelp")}
            </SettingsDescription>
            {themeChoice.error && (
              <p role="alert" className="text-xs text-red-600">
                {themeChoice.error}
              </p>
            )}
          </div>
          <ThemeSegmentedUI
            variant="settings"
            label={t("settings.appearance.theme")}
            value={themeChoice.theme ?? profile.theme}
            busy={themeChoice.saving}
            labels={{
              light: t("settings.appearance.themeLight"),
              dark: t("settings.appearance.themeDark"),
              system: t("settings.appearance.themeSystem"),
            }}
            onChange={(next) => void themeChoice.choose(next)}
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

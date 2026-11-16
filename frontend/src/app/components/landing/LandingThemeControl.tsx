"use client";

import { useTranslations } from "next-intl";
import { ThemeSegmentedUI } from "@mike/ui";
import { useThemePreference } from "./useThemePreference";

/**
 * Claro, Oscuro or Automático: `ThemeSegmentedUI`, the app's own control, with
 * the page's pill shape and 44 px options. It saves to `litt:theme` on this
 * device (a visitor has no profile), the same preference the app reads.
 */
export function LandingThemeControl() {
    const t = useTranslations();
    const { preference, choose } = useThemePreference();
    return (
        <ThemeSegmentedUI
            variant="settings"
            arrows="horizontal"
            value={preference}
            onChange={choose}
            label={t("landing.footer.theme")}
            labels={{
                light: t("landing.footer.themeLight"),
                dark: t("landing.footer.themeDark"),
                system: t("landing.footer.themeSystem"),
            }}
            className="w-auto gap-1 rounded-full border-0 p-[3px] ring-1 ring-inset ring-foreground/14 [&_button]:min-h-11 [&_button]:flex-none [&_button]:rounded-full [&_button]:px-3.5 [&_button]:text-[0.9375rem] [&_button]:font-serif"
        />
    );
}

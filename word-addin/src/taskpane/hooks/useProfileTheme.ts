import { useEffect } from "react";
import {
  applyDarkMode,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  type Theme,
} from "@mike/client";
import { getUserProfile } from "../api/mikeApi";

/**
 * What "Automático" means inside Word: Office's own theme (Black or Dark Gray
 * is dark) when the host reports it, and otherwise the device's
 * `prefers-color-scheme`. Office.context is absent outside Word, and older
 * hosts do not have `officeTheme`; both read as "ask the device".
 */
export function officeDarkTheme(): boolean | undefined {
  try {
    const dark = Office?.context?.officeTheme?.isDarkTheme;
    return typeof dark === "boolean" ? dark : undefined;
  } catch {
    return undefined;
  }
}

export function paneSystemDark(): boolean {
  return officeDarkTheme() ?? systemPrefersDark();
}

/**
 * Follows the theme saved in the user's LiTT profile, as the web app does
 * (Claro, Oscuro, or Automático, which follows Office and then the device).
 * Signed out, the pane is light. If the profile cannot be read the pane keeps
 * its current theme: only colors are at stake, so nothing is reported. The
 * pane has no control for the theme: it is chosen on the web.
 */
export function useProfileTheme(userId: string | null): void {
  useEffect(() => {
    if (!userId) {
      applyDarkMode(false);
      return;
    }
    let cancelled = false;
    let stopWatching = () => {};
    const apply = (theme: Theme) => {
      stopWatching();
      stopWatching = () => {};
      applyDarkMode(resolveTheme(theme, paneSystemDark()) === "dark");
      if (theme === "system") {
        // Office has no change event in Word; the device's does.
        stopWatching = watchSystemTheme(() =>
          applyDarkMode(resolveTheme("system", paneSystemDark()) === "dark"),
        );
      }
    };
    void getUserProfile()
      .then((profile) => {
        if (!cancelled && profile.theme) apply(profile.theme);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [userId]);
}

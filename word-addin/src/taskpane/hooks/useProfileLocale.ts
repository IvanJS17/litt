import { useEffect } from "react";
import { isLocale } from "@litt/i18n";
import { getUserProfile } from "../api/mikeApi";
import { useLocaleControls } from "../i18n/LocaleProvider";

/**
 * Follows the interface language saved in the user's LiTT profile, as the
 * web app does. A profile without one (`null`) keeps the language already
 * in use: the one picked on this device or Word's own. If the profile cannot
 * be read the pane keeps its language and reports nothing, as the theme does.
 */
export function useProfileLocale(userId: string | null): void {
  const { setLocale } = useLocaleControls();
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getUserProfile()
      .then((profile) => {
        if (cancelled || !isLocale(profile.uiLocale)) return undefined;
        return setLocale(profile.uiLocale);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, setLocale]);
}

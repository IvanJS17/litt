import { useEffect } from "react";
import { applyDarkMode } from "@mike/client";
import { getUserProfile } from "../api/mikeApi";

/**
 * Follows the dark theme saved in the user's LiTT profile, as the web app
 * does. Signed out, the pane is light. If the profile cannot be read the
 * pane keeps its current theme: only colors are at stake, so nothing is
 * reported.
 */
export function useProfileTheme(userId: string | null): void {
  useEffect(() => {
    if (!userId) {
      applyDarkMode(false);
      return;
    }
    let cancelled = false;
    void getUserProfile()
      .then((profile) => {
        if (!cancelled) applyDarkMode(profile.darkMode === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
}

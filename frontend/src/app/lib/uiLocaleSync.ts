import { isLocale, LOCALE_COOKIE } from "@litt/i18n";
import { updateUserProfile } from "@/app/lib/mikeApi";

/**
 * The web language selector only sets the LITT_LOCALE cookie, and it lives on
 * the signed-out screens. Once the person is signed in, copy that explicit
 * choice to the profile's `ui_locale` so the Word add-in, which reads the
 * profile, opens in the same language. With no cookie there is no choice to
 * copy (the page followed the browser), so a language picked in the add-in is
 * never overwritten. A failure is ignored: the next profile load tries again.
 */
export async function syncUiLocale(
    saved: string | null | undefined,
    cookies: string = typeof document === "undefined" ? "" : document.cookie,
): Promise<void> {
    const chosen = cookies
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([name]) => name === LOCALE_COOKIE)?.[1];
    if (!chosen || !isLocale(chosen) || chosen === saved) return;
    try {
        await updateUserProfile({ uiLocale: chosen });
    } catch {
        // Best effort; see above.
    }
}

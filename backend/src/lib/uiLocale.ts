// The interface languages LiTT ships. The database CHECK on
// user_profiles.ui_locale (migration 20261107_80) lists the same values.
import type { UiLocale } from "@mike/contracts";

export const UI_LOCALES = ["en-US", "es-MX"] as const satisfies readonly UiLocale[];

export function isUiLocale(value: unknown): value is UiLocale {
    return (UI_LOCALES as readonly unknown[]).includes(value);
}

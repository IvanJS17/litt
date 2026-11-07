// @litt/i18n: the locales LiTT's interface speaks and the catalog behind them.
// Framework-free so the web app and the Word add-in share one definition;
// each app wires it into its own provider. See ../README.md.
import type enUS from "../messages/en-US.json";

export const LOCALES = ["es-MX", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

/** Used when nothing the user or the browser asked for is supported. */
export const DEFAULT_LOCALE: Locale = "es-MX";

/** Cookie that carries the chosen locale between requests. */
export const LOCALE_COOKIE = "LITT_LOCALE";

/** en-US is the source catalog; every other locale has exactly its keys. */
export type Messages = typeof enUS;

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

const language = (tag: string) => tag.split(/[-_]/)[0].toLowerCase();

/**
 * Picks the locale for the first requested tag LiTT supports, in order of
 * preference (for example: the saved choice, then the browser's languages).
 * A tag matches exactly, ignoring case, or by its language alone, so "es",
 * "es-ES" and "es-419" give es-MX and "en-GB" gives en-US.
 */
export function negotiateLocale(requested: Iterable<string | null | undefined>): Locale {
    for (const raw of requested) {
        const tag = raw?.trim();
        if (!tag || tag === "*") continue;
        const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
        if (exact) return exact;
        const sameLanguage = LOCALES.find((l) => language(l) === language(tag));
        if (sameLanguage) return sameLanguage;
    }
    return DEFAULT_LOCALE;
}

const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
    "en-US": () => import("../messages/en-US.json"),
    "es-MX": () => import("../messages/es-MX.json"),
};

/** Loads one locale's catalog, so a bundle only carries the active language. */
export async function loadMessages(locale: Locale): Promise<Messages> {
    return (await loaders[locale]()).default;
}

// @litt/i18n: the locales LiTT's interface speaks and the catalog behind them.
// Framework-free so the web app and the Word add-in share one definition;
// each app wires it into its own provider. See ../README.md.
import enUS from "../messages/en-US.json";

export const LOCALES = ["es-MX", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

/** Used when nothing the user or the browser asked for is supported. */
export const DEFAULT_LOCALE: Locale = "es-MX";

/** The source catalog: every other locale falls back to it key by key. */
export const SOURCE_LOCALE = "en-US" satisfies Locale;

/** Cookie that carries the chosen locale between requests. */
export const LOCALE_COOKIE = "LITT_LOCALE";

/** en-US is the source catalog; every other locale has exactly its keys. */
export type Messages = typeof enUS;

/**
 * The source catalog, loaded with the module. Code that must say something
 * before (or without) an app loading its locale, such as @mike/client's
 * failure messages, starts from it; screens use loadMessages.
 */
export const SOURCE_MESSAGES: Messages = enUS;

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

const language = (tag: string) => tag.replace(/[-_].*$/, "").toLowerCase();

/**
 * Picks the locale for the first requested tag LiTT supports, in order of
 * preference (for example: the saved choice, then the browser's languages).
 * A tag matches exactly, ignoring case, or by its language alone, so "es",
 * "es-ES" and "es-419" give es-MX and "en-GB" gives en-US.
 *
 * The input is a list of bare tags, already in order of preference. It does
 * not read quality values: pass an Accept-Language header through
 * parseAcceptLanguage first. A bare string is rejected rather than read
 * character by character.
 */
export function negotiateLocale(requested: readonly (string | null | undefined)[]): Locale {
    if (!Array.isArray(requested)) {
        throw new TypeError("negotiateLocale expects an array of language tags");
    }
    for (const raw of requested) {
        const tag = typeof raw === "string" ? raw.trim() : "";
        if (!tag || tag === "*") continue;
        const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
        if (exact) return exact;
        const sameLanguage = LOCALES.find((l) => language(l) === language(tag));
        if (sameLanguage) return sameLanguage;
    }
    return DEFAULT_LOCALE;
}

/**
 * The language tags of an Accept-Language header, most preferred first
 * (RFC 9110 §12.5.4): sorted by quality, ties keep their order, and tags with
 * q=0 ("not acceptable") or a malformed quality are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
    if (typeof header !== "string") return [];
    const ranges: { tag: string; q: number; index: number }[] = [];
    header.split(",").forEach((part, index) => {
        const [rawTag = "", ...params] = part.split(";");
        const tag = rawTag.trim();
        if (!tag) return;
        let q = 1;
        for (const param of params) {
            const [name = "", value = ""] = param.split("=").map((s) => s.trim());
            if (name.toLowerCase() !== "q") continue;
            q = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(value) ? Number(value) : 0;
        }
        if (q > 0) ranges.push({ tag, q, index });
    });
    return ranges.sort((a, b) => b.q - a.q || a.index - b.index).map((r) => r.tag);
}

type Tree = { [key: string]: string | Tree };

// The locale's messages over the source catalog, so a key a translation
// lacks still shows its English text instead of breaking the screen. The
// catalog parity test keeps that from happening in CI; this covers what it
// cannot see, such as a key added to en-US by an upstream merge before its
// translation lands.
function overSource(source: Tree, translated: Tree): Tree {
    const out: Tree = { ...source };
    for (const [key, value] of Object.entries(translated)) {
        const base = out[key];
        out[key] =
            typeof value === "object" && value !== null && typeof base === "object"
                ? overSource(base, value)
                : value;
    }
    return out;
}

// Translations load on demand; the source is already here (SOURCE_MESSAGES).
const translations: Record<Exclude<Locale, typeof SOURCE_LOCALE>, () => Promise<{ default: unknown }>> = {
    "es-MX": () => import("../messages/es-MX.json"),
};

/**
 * Loads one locale's catalog, filled in from en-US where a key is missing.
 * An unsupported value (an unvalidated cookie, say) loads DEFAULT_LOCALE
 * instead of failing.
 */
export async function loadMessages(locale: Locale): Promise<Messages> {
    const supported = isLocale(locale) ? locale : DEFAULT_LOCALE;
    if (supported === SOURCE_LOCALE) return SOURCE_MESSAGES;
    const translated = await translations[supported]();
    return overSource(SOURCE_MESSAGES as Tree, translated.default as Tree) as Messages;
}

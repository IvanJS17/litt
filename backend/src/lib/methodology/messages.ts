// The words of the methodology annex, read from the shared catalog
// (packages/i18n, namespace training.criterion.methodology) so the backend and
// the apps never keep two copies of a text.
//
// The backend has no use-intl and does not bundle the catalog: it reads the two
// JSON files from packages/i18n/messages at first use (see CATALOG_DIR) and
// fills `{name}` arguments itself. That is all these messages need (no plural,
// select or date arguments: dates are formatted here and passed in as text).
// A key missing from the person's locale falls back to en-US, like loadMessages.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_UI_LOCALE, isUiLocale, type MethodologyLocale } from "./locale";

/**
 * packages/i18n/messages next to the repository root in development
 * (backend/src/lib/methodology → ../../../../packages) and at /packages in the
 * image (/app/dist/lib/methodology → ../../../../packages); backend/Dockerfile
 * copies it there.
 */
export const CATALOG_DIR = path.resolve(__dirname, "../../../../packages/i18n/messages");
const NAMESPACE = ["training", "criterion", "methodology"] as const;

type Tree = { [key: string]: string | Tree };
const cache = new Map<MethodologyLocale, Tree>();

function catalog(locale: MethodologyLocale): Tree {
    let tree = cache.get(locale);
    if (!tree) {
        const all = JSON.parse(readFileSync(path.join(CATALOG_DIR, `${locale}.json`), "utf8")) as Tree;
        tree = NAMESPACE.reduce<Tree>((node, key) => (node[key] as Tree | undefined) ?? {}, all);
        cache.set(locale, tree);
    }
    return tree;
}

function lookup(tree: Tree, key: string): string | undefined {
    const prefix = `${NAMESPACE.join(".")}.`;
    if (!key.startsWith(prefix)) return undefined;
    let node: string | Tree | undefined = tree;
    for (const part of key.slice(prefix.length).split(".")) {
        if (typeof node !== "object" || node === null) return undefined;
        node = node[part];
    }
    return typeof node === "string" ? node : undefined;
}

export type Say = (key: string, args?: Record<string, string | number>) => string;

export type MethodologyText = {
    locale: MethodologyLocale;
    /** A catalog message by its full key, with its `{name}` arguments filled in. */
    say: Say;
    /** A calendar day (YYYY-MM-DD) in the locale's format; the day does not move with any time zone. */
    day: (isoDay: string) => string;
    /** The calendar day of an instant in Mexico City, in the locale's format. */
    today: (instant: Date) => string;
};

const DATE_PARTS = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
export const ANNEX_TIME_ZONE = "America/Mexico_City";

export function methodologyText(requested?: unknown): MethodologyText {
    const locale: MethodologyLocale = isUiLocale(requested) ? requested : DEFAULT_UI_LOCALE;
    const say: Say = (key, args = {}) => {
        const message = lookup(catalog(locale), key) ?? lookup(catalog("en-US"), key);
        if (message === undefined) throw new Error(`Missing methodology message: ${key}`);
        return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in args ? String(args[name]) : whole));
    };
    const format = (timeZone: string, date: Date) =>
        new Intl.DateTimeFormat(locale, { ...DATE_PARTS, timeZone }).format(date);
    return {
        locale,
        say,
        day: (isoDay) => format("UTC", new Date(`${isoDay}T00:00:00Z`)),
        today: (instant) => format(ANNEX_TIME_ZONE, instant),
    };
}

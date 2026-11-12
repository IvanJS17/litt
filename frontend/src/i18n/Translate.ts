import type { Messages } from "@litt/i18n";

type Leaves<T, P extends string> = T extends string
    ? P
    : { [K in keyof T & string]: Leaves<T[K], `${P}.${K}`> }[keyof T & string];

/** Every catalog key the Settings and Organizations screens read. */
export type SettingsKey =
    | Leaves<Messages["settings"], "settings">
    | Leaves<Messages["organizations"], "organizations">
    | Leaves<Messages["errors"], "errors">
    | Leaves<Messages["common"], "common">;

/**
 * A message translator, as `useTranslations()` returns it. Helpers that build
 * visible text take the component's own `t` instead of reaching for a
 * module-level translator, so they work under server rendering too.
 */
export type Translate = (
    key: SettingsKey,
    values?: Record<string, string | number | Date>,
) => string;

/** Every catalog key the shared panels, the assistant and the documents read. */
export type AppKey =
    | SettingsKey
    | Leaves<Messages["shared"], "shared">
    | Leaves<Messages["documents"], "documents">
    | Leaves<Messages["history"], "history">;

/** `Translate` for helpers outside Settings: same shape, more namespaces. */
export type AppTranslate = (
    key: AppKey,
    values?: Record<string, string | number | Date>,
) => string;

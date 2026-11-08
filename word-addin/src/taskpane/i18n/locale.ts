/**
 * Which interface language the task pane speaks, before and after sign-in.
 *
 * Order (plan i18n §2.4): the profile's `uiLocale`, applied by App once the
 * session is known; else the choice saved on this device (`litt.locale`,
 * written whenever a language is picked or read from the profile); else
 * Word's own display language, mapped to es-MX or en-US; else es-MX.
 *
 * Pure and storage-injectable so each rule can be asserted without Word.
 */
import { DEFAULT_LOCALE, isLocale, negotiateLocale, type Locale } from "@litt/i18n";

/** localStorage key for the language chosen on this device. */
export const LOCALE_STORAGE_KEY = "litt.locale";

/** Every date and time is shown in Mexico City time (plan i18n Q5). */
export const TIME_ZONE = "America/Mexico_City";

type LocaleStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): LocaleStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some Word webviews refuse storage; the language then follows Word.
    return null;
  }
}

/** `Office.context.displayLanguage` ("es-ES", "en-GB", ...) as es-MX or en-US. */
export function localeFromDisplayLanguage(
  displayLanguage: string | null | undefined,
): Locale {
  return negotiateLocale([displayLanguage]);
}

/** Word's display language, or undefined where Office is not available. */
export function wordDisplayLanguage(): string | undefined {
  try {
    return typeof Office === "undefined"
      ? undefined
      : Office.context?.displayLanguage;
  } catch {
    return undefined;
  }
}

export function readStoredLocale(
  storage: LocaleStorage | null = defaultStorage(),
): Locale | null {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(
  locale: Locale,
  storage: LocaleStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not saved: the next open follows the profile or Word again.
  }
}

/** The language to start in, before any profile has been read. */
export function initialLocale(
  storage: LocaleStorage | null = defaultStorage(),
  displayLanguage: string | undefined = wordDisplayLanguage(),
): Locale {
  return (
    readStoredLocale(storage) ??
    (displayLanguage ? localeFromDisplayLanguage(displayLanguage) : DEFAULT_LOCALE)
  );
}

import { configureClientLocale } from "@mike/client";
import { loadMessages, type Locale, type Messages } from "@litt/i18n";

export interface LoadedLocale {
  locale: Locale;
  messages: Messages;
}

/**
 * Load a locale's catalog and point plain-function text (errors, toasts) at
 * it. Kept apart from the React provider so the OAuth dialog, which has no
 * React, can use it.
 */
export async function loadLocale(locale: Locale): Promise<LoadedLocale> {
  const messages = await loadMessages(locale);
  configureClientLocale(locale, messages);
  return { locale, messages };
}

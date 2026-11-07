/**
 * The interface locale this client speaks outside React.
 *
 * Failure messages, toast labels and the auth sentences are produced in
 * plain functions (describeError, retryToastAction, ...) that cannot read a
 * React provider, so they translate through this one module-level
 * translator. Each app configures it once with the locale and catalog its
 * provider received (the web app's IntlClientProvider); until then, and in
 * an app that never does (the Word add-in until its own locale arrives), it
 * speaks the en-US source catalog.
 *
 * Browser only: on a server one module serves every request, so a server
 * render must not configure it (the web app's provider skips it there).
 */
import { createTranslator } from "use-intl";
import {
    SOURCE_LOCALE,
    SOURCE_MESSAGES,
    type Locale,
    type Messages,
} from "@litt/i18n";

function translatorFor(locale: Locale, messages: Messages) {
    return createTranslator({
        locale,
        messages,
        // A missing key is already filled from en-US by loadMessages; one
        // absent from the source too shows its key and is logged where it
        // can be fixed. Nothing is sent anywhere.
        onError: (error) => {
            if (process.env.NODE_ENV !== "production") console.warn(error.message);
        },
        getMessageFallback: ({ namespace, key }) =>
            namespace ? `${namespace}.${key}` : key,
    });
}

export type ClientTranslator = ReturnType<typeof translatorFor>;

let current: { locale: Locale; messages: Messages; t: ClientTranslator } = {
    locale: SOURCE_LOCALE,
    messages: SOURCE_MESSAGES,
    t: translatorFor(SOURCE_LOCALE, SOURCE_MESSAGES),
};

/** Make this app's plain-function text follow `locale`. Cheap to repeat. */
export function configureClientLocale(locale: Locale, messages: Messages): void {
    if (current.locale === locale && current.messages === messages) return;
    current = { locale, messages, t: translatorFor(locale, messages) };
}

export function clientLocale(): Locale {
    return current.locale;
}

/** The translator for the configured locale; read it at the moment of use. */
export function clientTranslator(): ClientTranslator {
    return current.t;
}

/** A translator that always speaks the source catalog (en-US). */
export const sourceTranslator: ClientTranslator = translatorFor(
    SOURCE_LOCALE,
    SOURCE_MESSAGES,
);

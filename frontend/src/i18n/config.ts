// The next-intl settings shared by the server (request.ts) and the client
// provider (IntlClientProvider.tsx). Functions cannot cross from a server
// component to a client one, so both import them from here.
import { IntlErrorCode, type IntlError } from "next-intl";

/** Every date and time is shown in Mexico City time (plan i18n Q5). */
export const TIME_ZONE = "America/Mexico_City";

/**
 * A missing or malformed message must never break a screen. Missing keys are
 * already filled from en-US by loadMessages, so reaching here means the key
 * is absent from the source too: log it in development, where it can be
 * fixed, and stay quiet in production. Nothing is sent anywhere.
 */
export function onIntlError(error: IntlError) {
    if (process.env.NODE_ENV === "production") return;
    if (error.code === IntlErrorCode.MISSING_MESSAGE) console.warn(error.message);
    else console.error(error);
}

/** Shown in place of a message that cannot be rendered: its key. */
export function getMessageFallback({ namespace, key }: { namespace?: string; key: string }) {
    return namespace ? `${namespace}.${key}` : key;
}

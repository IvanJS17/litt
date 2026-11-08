"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@litt/i18n";

/** The cookie lives a year (plan i18n §2.1); it is a preference, not a secret. */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Remembers the interface language in the LITT_LOCALE cookie, which
 * i18n/request.ts reads so the next render already speaks it. The argument
 * comes from the browser and is not trusted: anything outside the supported
 * list is refused and the cookie is left alone. Resolves to whether it was set.
 */
export async function setLocale(locale: string): Promise<boolean> {
    if (!isLocale(locale)) return false;
    (await cookies()).set(LOCALE_COOKIE, locale, {
        path: "/",
        sameSite: "lax",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        httpOnly: false,
    });
    return true;
}

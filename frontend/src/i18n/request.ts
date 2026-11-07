// next-intl's request configuration (next.config.ts points the plugin here).
// LiTT has no locale in the URL: the locale is the LITT_LOCALE cookie, then
// the browser's Accept-Language, then es-MX (plan i18n §2.2).
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import {
    LOCALE_COOKIE,
    loadMessages,
    negotiateLocale,
    parseAcceptLanguage,
} from "@litt/i18n";
import { getMessageFallback, onIntlError, TIME_ZONE } from "./config";

export default getRequestConfig(async () => {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    const locale = negotiateLocale([
        cookieStore.get(LOCALE_COOKIE)?.value,
        ...parseAcceptLanguage(headerList.get("accept-language")),
    ]);
    return {
        locale,
        messages: await loadMessages(locale),
        timeZone: TIME_ZONE,
        onError: onIntlError,
        getMessageFallback,
    };
});

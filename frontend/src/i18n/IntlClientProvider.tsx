"use client";

// The root layout's next-intl provider for client components. They do not
// inherit onError and getMessageFallback from request.ts, so this client
// boundary sets them (next-intl docs, "usage/configuration").
import { NextIntlClientProvider } from "next-intl";
import type { Locale, Messages } from "@litt/i18n";
import { configureClientLocale } from "@mike/client";
import { getMessageFallback, onIntlError, TIME_ZONE } from "./config";

export function IntlClientProvider({
    locale,
    messages,
    children,
}: {
    locale: Locale;
    messages: Messages;
    children: React.ReactNode;
}) {
    // Failure messages and toast labels are made outside React
    // (@mike/client); point them at this locale before any child renders.
    // In the browser only: on the server one module serves every request.
    if (typeof window !== "undefined") configureClientLocale(locale, messages);
    return (
        <NextIntlClientProvider
            locale={locale}
            messages={messages}
            timeZone={TIME_ZONE}
            onError={onIntlError}
            getMessageFallback={getMessageFallback}
        >
            {children}
        </NextIntlClientProvider>
    );
}

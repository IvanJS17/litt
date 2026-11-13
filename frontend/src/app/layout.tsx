import type { Metadata } from "next";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { preload } from "react-dom";
import interLatin from "./fonts/inter-latin.woff2";
import ebGaramondLatin from "./fonts/eb-garamond-latin.woff2";
import { Providers } from "@/app/components/providers";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { THEME_BOOT_SCRIPT } from "@/app/lib/theme";
import { TITLE_TEMPLATE } from "@/app/lib/documentTitle";

// LiTT's public address (deploy/prod/README.md). MikeOSS, the upstream, is
// credited in the README.
const SITE_URL = "https://litt.asteroitt.com";

export async function generateMetadata(): Promise<Metadata> {
    const [t, locale] = await Promise.all([getTranslations("common.meta"), getLocale()]);
    const title = t("title");
    const description = t("description");
    return {
        metadataBase: new URL(SITE_URL),
        // A screen names itself; the template adds the product ("Settings · LiTT").
        // One with no name of its own keeps the full product title.
        title: { default: title, template: TITLE_TEMPLATE },
        description,
        icons: {
            icon: [
                { url: "/icon.svg", type: "image/svg+xml" },
                { url: "/favicon.ico" },
            ],
            apple: "/apple-touch-icon.png",
        },
        openGraph: {
            type: "website",
            url: SITE_URL,
            siteName: "LiTT",
            locale: locale.replace("-", "_"),
            title,
            description,
            images: [
                {
                    url: "/link-image.jpg",
                    width: 1200,
                    height: 651,
                    alt: "LiTT",
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: ["/link-image.jpg"],
        },
    };
}

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // The locale request.ts resolved (cookie, browser, es-MX) and its catalog.
    const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
    // The two files a Spanish or English page really draws (the latin subset of
    // each family), fetched with the HTML so the text does not jump when the
    // letters arrive. The other subsets stay lazy: fonts.css loads them only
    // for a page that has such a character.
    for (const href of [interLatin, ebGaramondLatin])
        preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
    return (
        // The boot script may add `dark` and color-scheme to <html> before
        // React hydrates it; that difference is intended.
        <html lang={locale} suppressHydrationWarning>
            <head>
                <script
                    dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
                />
            </head>
            <body
                className="font-sans antialiased"
            >
                <IntlClientProvider locale={locale} messages={messages}>
                    <Providers>{children}</Providers>
                </IntlClientProvider>
            </body>
        </html>
    );
}

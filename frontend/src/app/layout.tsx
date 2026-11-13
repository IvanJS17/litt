import type { Metadata, Viewport } from "next";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "@/app/components/providers";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { THEME_BOOT_SCRIPT } from "@/app/lib/theme";

// LiTT's public address (deploy/prod/README.md). MikeOSS, the upstream, is
// credited in the README.
const SITE_URL = "https://litt.asteroitt.com";

// `cover` lets the page reach under the notch and the home indicator, so the
// safe-area insets (env(safe-area-inset-*)) start to mean something: the
// mobile header, chat composer, sidebar and notices keep clear of them. The
// zoom stays available (no maximum-scale).
export const viewport: Viewport = {
    viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
    const [t, locale] = await Promise.all([getTranslations("common.meta"), getLocale()]);
    const title = t("title");
    const description = t("description");
    return {
        metadataBase: new URL(SITE_URL),
        title,
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

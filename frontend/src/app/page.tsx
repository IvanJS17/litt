import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { LandingPage } from "@/app/components/landing/LandingPage";
import { hasSessionCookie } from "@/app/lib/sessionHint";
import { SITE_URL } from "@/app/lib/siteUrl";

// The public address (the same one app/layout.tsx puts in `metadataBase`).

/**
 * The start page's own title and description (the root layout's template would
 * add " · LiTT" to a name, and this one already starts with it). The share
 * image is the app's `public/link-image.jpg`. Search engines stay turned away
 * while the beta is closed: `robots` is the layout's, untouched.
 */
export async function generateMetadata(): Promise<Metadata> {
    const [t, locale] = await Promise.all([getTranslations("landing.meta"), getLocale()]);
    const title = t("title");
    const description = t("description");
    return {
        title: { absolute: title },
        description,
        openGraph: {
            type: "website",
            url: SITE_URL,
            siteName: "LiTT",
            locale: locale.replace("-", "_"),
            title,
            description,
            images: [{ url: "/link-image.jpg", width: 1200, height: 651, alt: "LiTT" }],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: ["/link-image.jpg"],
        },
    };
}

/**
 * `/` is the public page of LiTT, the same with or without a session (it used
 * to redirect to /assistant). Only the main button differs, and it is decided
 * here, from the session cookie, so the HTML already has the right one. The
 * installed app does not change: the manifest still starts at /assistant.
 */
export default async function RootPage() {
    const names = (await cookies()).getAll().map((cookie) => cookie.name);
    return <LandingPage signedIn={hasSessionCookie(names)} />;
}

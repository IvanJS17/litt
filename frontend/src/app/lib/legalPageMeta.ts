import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Messages } from "@litt/i18n";
import type { PageTitleKey } from "@/app/lib/pageTitle";
import { SITE_URL } from "@/app/lib/siteUrl";

export type LegalPageKey = PageTitleKey & keyof Messages["common"]["pageDescription"];

/**
 * Title, description, canonical and indexable `robots` for a public legal
 * page (`/privacidad`, `/terminos`). Both are in
 * `PUBLIC_INDEXABLE_PATHS` (lib/searchIndexing.ts): this overrides the root
 * layout's default noindex the same way `page.tsx` (the start page) does.
 *
 *     export const generateMetadata = legalPageMeta("privacy", "/privacidad");
 */
export function legalPageMeta(key: LegalPageKey, path: `/${string}`): () => Promise<Metadata> {
    return async () => {
        const [title, description] = await Promise.all([
            getTranslations("common.pageTitle").then((t) => t(key)),
            getTranslations("common.pageDescription").then((t) => t(key)),
        ]);
        return {
            title,
            description,
            alternates: { canonical: `${SITE_URL}${path}` },
            robots: { index: true, follow: true },
        };
    };
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Messages } from "@litt/i18n";

// Server only (it reads the request's locale). The shared constants and the
// client hook are in documentTitle.ts.

export type PageTitleKey = keyof Messages["common"]["pageTitle"];

/**
 * The title of a screen, for the `generateMetadata` export of its layout or
 * page. The root layout's `title.template` adds " · LiTT". A screen whose
 * name is only known after it loads (a chat, a project) sets it with
 * `useDocumentTitle` instead.
 *
 *     export const generateMetadata = pageTitle("login");
 */
export function pageTitle(key: PageTitleKey): () => Promise<Metadata> {
    return async () => {
        const t = await getTranslations("common.pageTitle");
        return { title: t(key) };
    };
}

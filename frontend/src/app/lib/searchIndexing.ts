/**
 * Which pages search engines and AI crawlers may list.
 *
 * LiTT stays invitation-only (beta por invitación, aprobado por Iván
 * 2026-11-20): nobody signs up without an invite, and the product itself
 * does not open up. What changed is that the three pages anyone can already
 * open without an account — the start page and the two legal pages — may
 * now be found by Google and AI answers. Everything else (login, signup,
 * the app, every authenticated route, the API, and the Word add-in and MCP
 * subdomains) keeps asking crawlers not to list it, the same three ways as
 * before:
 *
 * | Where | What it does |
 * | --- | --- |
 * | `frontend/src/app/robots.ts` | `Allow` for exactly these paths, `Disallow` for the rest. |
 * | `frontend/next.config.ts` (`headers()`) | `X-Robots-Tag: noindex, nofollow` on every response outside this list. |
 * | `frontend/src/app/layout.tsx` (`metadata.robots`) | `noindex, nofollow` by default; each public page overrides it in its own `generateMetadata`. |
 *
 * This list is deliberately an allowlist of exact paths, not a "disallow
 * these and allow the rest" rule: a new route is noindex by default and
 * must be added here on purpose to become indexable.
 */
export const PUBLIC_INDEXABLE_PATHS = ["/", "/privacidad", "/terminos"] as const;

export type PublicIndexablePath = (typeof PUBLIC_INDEXABLE_PATHS)[number];

/**
 * Static resources the public pages' HTML needs so a crawler can render
 * them: the build-hashed JS/CSS/font bundle, the icons declared in
 * `layout.tsx`'s `metadata.icons`, and the Open Graph/Twitter image. Google
 * (and other renderer-based crawlers) fetches every resource a page
 * references and checks each one against `robots.txt`; blocking these with
 * the blanket `Disallow: /` made Google render the public pages unstyled
 * and without their social image. `robots.ts` allows them as path
 * *prefixes* (no `$` anchor), unlike `PUBLIC_INDEXABLE_PATHS`'s exact-path
 * match: they are not pages themselves, so robots.txt only grants fetch
 * access, while `next.config.ts`'s `X-Robots-Tag: noindex` (via
 * `noindexHeaderSource()`) still keeps every one of them out of Google's
 * own index as a listed URL.
 */
export const PUBLIC_RESOURCE_PATHS = [
    "/_next/static/",
    "/favicon.ico",
    "/icon.svg",
    "/apple-touch-icon.png",
    "/link-image.jpg",
    "/robots.txt",
    "/sitemap.xml",
] as const;

export function isPublicIndexablePath(pathname: string): boolean {
    return (PUBLIC_INDEXABLE_PATHS as readonly string[]).includes(pathname);
}

/** The value of the `X-Robots-Tag` header outside the public, indexable pages. */
export const NOINDEX_DIRECTIVE = "noindex, nofollow";

/**
 * A `next.config.ts` `headers()` `source` pattern matching every path except
 * `PUBLIC_INDEXABLE_PATHS` (root, or with or without a trailing slash),
 * built from that list so the two can never drift apart. Next.js resolves
 * this with the same path-to-regexp engine as `redirects()`/`rewrites()`;
 * `searchIndexing.test.ts` pins the exact strings it must exclude.
 */
export function noindexHeaderSource(): string {
    const segments = PUBLIC_INDEXABLE_PATHS.filter((path) => path !== "/").map((path) => path.slice(1));
    const exclusions = [...segments.map((segment) => `${segment}\\/?$`), "$"].join("|");
    return `/:path((?!${exclusions}).*)`;
}

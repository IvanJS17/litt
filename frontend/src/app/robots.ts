import type { MetadataRoute } from "next";
import { PUBLIC_INDEXABLE_PATHS, PUBLIC_RESOURCE_PATHS } from "@/app/lib/searchIndexing";
import { SITE_URL } from "@/app/lib/siteUrl";

/**
 * Served as text/plain at /robots.txt. Explicit allowlist, not "disallow
 * these and allow the rest": only PUBLIC_INDEXABLE_PATHS are open to
 * crawlers as pages (the `$` anchors each to an exact path, not a prefix),
 * plus PUBLIC_RESOURCE_PATHS as fetchable prefixes so a renderer-based
 * crawler can load the CSS/JS/fonts/icons those pages need — otherwise it
 * sees them broken or unstyled. Everything else is disallowed. See
 * lib/searchIndexing.ts and docs/search-indexing.md.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: [
                ...PUBLIC_INDEXABLE_PATHS.map((path) => (path === "/" ? "/$" : `${path}$`)),
                ...PUBLIC_RESOURCE_PATHS,
            ],
            disallow: "/",
        },
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}

import type { MetadataRoute } from "next";
import { PUBLIC_INDEXABLE_PATHS } from "@/app/lib/searchIndexing";
import { SITE_URL } from "@/app/lib/siteUrl";

/**
 * Served as text/plain at /robots.txt. Explicit allowlist, not "disallow
 * these and allow the rest": only PUBLIC_INDEXABLE_PATHS are open to
 * crawlers (the `$` anchors each to an exact path, not a prefix), and
 * everything else is disallowed. See lib/searchIndexing.ts and
 * docs/search-indexing.md.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: PUBLIC_INDEXABLE_PATHS.map((path) => (path === "/" ? "/$" : `${path}$`)),
            disallow: "/",
        },
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}

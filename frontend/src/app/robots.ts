import type { MetadataRoute } from "next";
import { SEARCH_INDEXING_ALLOWED } from "@/app/lib/searchIndexing";

/**
 * Served as text/plain at /robots.txt. While the beta is closed it turns every
 * crawler away; see lib/searchIndexing.ts and docs/search-indexing.md.
 */
export default function robots(): MetadataRoute.Robots {
    return SEARCH_INDEXING_ALLOWED
        ? { rules: { userAgent: "*", allow: "/" } }
        : { rules: { userAgent: "*", disallow: "/" } };
}

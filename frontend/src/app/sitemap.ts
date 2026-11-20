import type { MetadataRoute } from "next";
import { PUBLIC_INDEXABLE_PATHS } from "@/app/lib/searchIndexing";
import { SITE_URL } from "@/app/lib/siteUrl";

/** Served at /sitemap.xml: exactly the public, indexable pages (lib/searchIndexing.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
    return PUBLIC_INDEXABLE_PATHS.map((path) => ({
        url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    }));
}

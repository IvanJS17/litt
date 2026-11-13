/**
 * Whether search engines may list LiTT.
 *
 * While the beta is closed they may not: the whole site says "noindex" three
 * ways, all from this one switch. `robots.txt` (app/robots.ts) disallows
 * everything, every response carries `X-Robots-Tag` (next.config.ts, and
 * public/_headers for a Cloudflare deploy), and every page has
 * `<meta name="robots" content="noindex, nofollow">` (app/layout.tsx).
 *
 * When the beta opens, set this to `true`, and change `public/_headers` to
 * match; docs/search-indexing.md has the whole checklist.
 */
export const SEARCH_INDEXING_ALLOWED = false;

/** The value of the `X-Robots-Tag` header while indexing is off. */
export const NOINDEX_DIRECTIVE = "noindex, nofollow";

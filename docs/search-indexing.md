# LiTT and search engines

**Status:** Shipped in production. LiTT is invitation-only; nobody signs up
without an invite and the product itself does not open up. Google and AI
crawlers may list the three pages anyone can already open without an
account: the start page and the two legal pages.

## What is on now

`PUBLIC_INDEXABLE_PATHS` in `frontend/src/app/lib/searchIndexing.ts`:
`/`, `/privacidad` and `/terminos`. It drives:

| Where | What it does |
| --- | --- |
| `frontend/src/app/robots.ts` | `/robots.txt`: `Allow` for exactly these paths (`$`-anchored, not a prefix), plus `Allow` prefixes for `PUBLIC_RESOURCE_PATHS` (the CSS/JS/fonts/icons/OG image those pages need to render), `Disallow` for the rest, plus `Sitemap`. |
| `frontend/src/app/sitemap.ts` | `/sitemap.xml` lists exactly these three URLs. |
| `frontend/next.config.ts` (`headers()`) | `X-Robots-Tag: noindex, nofollow` on every response except these paths, via `noindexHeaderSource()`. This still applies to `PUBLIC_RESOURCE_PATHS`: they are fetchable but not themselves listed. |
| `frontend/src/app/layout.tsx` (`metadata.robots`) | `noindex, nofollow` by default; each public page's own `generateMetadata` (`page.tsx`, `privacidad/page.tsx`, `terminos/page.tsx` via `lib/legalPageMeta.ts`) overrides it to `index, follow` and sets its own `alternates.canonical`. |
| `frontend/public/_headers` | The same split for a Cloudflare Pages deploy (`npm run deploy`); not read by the Caddy/Docker production path, kept in sync anyway. Unsets (`!`) the blanket `X-Robots-Tag` on the public paths instead of overriding it, because Cloudflare Pages joins header values from every matching rule. |

A renderer-based crawler (Googlebot, and most AI crawlers) fetches every
resource a page's HTML references and checks each one against
`robots.txt`; blocking `/_next/static/*` with the blanket `Disallow: /`
made it render the public pages unstyled and without their social image,
even though the pages themselves were allowed. `PUBLIC_RESOURCE_PATHS` in
`lib/searchIndexing.ts` fixes that: unlike `PUBLIC_INDEXABLE_PATHS`, it is
matched as path *prefixes*, because these are assets, not pages to list.

This is an **allowlist**, not "disallow these and allow the rest": a new
route stays noindex by default, and must be added to
`PUBLIC_INDEXABLE_PATHS` (and given its own `generateMetadata`) on purpose
to become indexable. Everything else — login, signup, the app, every
authenticated route, the API, and the `word.litt.asteroitt.com` and
`mcp.litt.asteroitt.com` subdomains — stays blocked exactly as before.

## Adding a public page later

1. Add its path to `PUBLIC_INDEXABLE_PATHS`.
2. Give it its own `generateMetadata` with `alternates.canonical` and
   `robots: { index: true, follow: true }` (see `lib/legalPageMeta.ts` for
   the two legal pages, or `page.tsx` for the start page).
3. `frontend/public/_headers` gets a matching `! X-Robots-Tag` block for the
   new path.
4. Verify from outside: `curl -sI https://litt.asteroitt.com/<path>` has no
   `X-Robots-Tag`, and `curl -s https://litt.asteroitt.com/robots.txt` allows
   it.
5. A page already seen by a crawler while blocked leaves its index only
   after the crawler revisits it with the block lifted, so do not flip a
   path back and forth: that can take weeks to resolve either way.

`frontend/src/__tests__/searchIndexing.test.ts` pins this allowlist and the
generated header pattern; update it in the same commit as any change here.

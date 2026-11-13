# LiTT and search engines

While the beta is closed, LiTT asks every search engine not to list it, at
`litt.asteroitt.com`. Nothing here hides the site: a person with the address
can still open it, and `robots.txt` is a request, not a lock. Access is
controlled by the invitation (see `docs/` on beta invitations).

## What is on now

One switch, `SEARCH_INDEXING_ALLOWED` in
`frontend/src/app/lib/searchIndexing.ts`, set to `false`. It drives:

| Where | What it does |
| --- | --- |
| `frontend/src/app/robots.ts` | `/robots.txt` is served as `text/plain`: `User-agent: *` / `Disallow: /`. |
| `frontend/next.config.ts` (`headers()`) | Every response from the web server carries `X-Robots-Tag: noindex, nofollow`. |
| `frontend/src/app/layout.tsx` (`metadata.robots`) | Every page has `<meta name="robots" content="noindex, nofollow">`. |
| `frontend/public/_headers` | The same `X-Robots-Tag` for a Cloudflare deploy (`npm run deploy`). It is not read by the Caddy/Docker production path. |

`robots.txt` is a real route, so crawlers get 200 and a few bytes, not the
404 page. There is no sitemap; `/sitemap.xml` is a plain 404.

## When the beta opens: how to revert

1. In `frontend/src/app/lib/searchIndexing.ts` set
   `SEARCH_INDEXING_ALLOWED = true`. That alone turns `robots.txt` into
   `Allow: /` and removes the header and the `<meta>`.
2. In `frontend/public/_headers` delete the `/*` block with `X-Robots-Tag`
   (only matters on a Cloudflare deploy; harmless to leave out of Docker).
3. Decide what should be listed. Most of the app is behind a login and gives
   a crawler nothing; the public pages are `/login`, `/terminos` and
   `/privacidad`. If you want only those, change `robots.ts` to
   `allow: ["/terminos", "/privacidad"]` with `disallow: "/"` and keep the
   meta on the rest.
4. Add a `sitemap.ts` if you want one (Next serves `app/sitemap.ts` at
   `/sitemap.xml`).
5. Deploy, then check from outside:
   `curl -sI https://litt.asteroitt.com/login | grep -i x-robots` prints
   nothing, and `curl -s https://litt.asteroitt.com/robots.txt` says `Allow`.
6. Pages already seen by a crawler leave its index only after the crawler
   revisits them with `noindex` in place, so do not lift the block and
   re-impose it: a page that was listed once can take weeks to leave.

`frontend/src/__tests__/searchIndexing.test.ts` pins the closed state; flip
its expectations in the same commit as the switch.

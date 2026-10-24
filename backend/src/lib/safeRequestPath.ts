/**
 * Diagnostic-safe form of a request URL for error logs and reports.
 *
 * `req.originalUrl` is the one request field that routinely carries secrets:
 * OAuth callbacks put `code`/`state` in the query string, and the
 * `/download/:token` route carries an HMAC-signed download token as a *path
 * segment* (see lib/downloadTokens.ts), so dropping the query alone would
 * still log a working credential. Operators only need the route to locate the
 * failure, so the query/fragment is dropped and credential-bearing path
 * segments are masked.
 */

/** Paths whose final segment is itself a credential. */
const CREDENTIAL_PATH_SEGMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\/download\/[^/]+/, "/download/[redacted]"],
];

export function safeRequestPath(url: string | undefined): string | undefined {
  if (!url) return url;
  const path = url.split(/[?#]/)[0];
  return CREDENTIAL_PATH_SEGMENTS.reduce(
    (safe, [pattern, replacement]) => safe.replace(pattern, replacement),
    path,
  );
}

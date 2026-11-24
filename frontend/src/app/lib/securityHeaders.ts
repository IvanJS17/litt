/**
 * The browser protection headers of the web application.
 *
 * Two parts, because the policy needs a fresh nonce for every page request and
 * the rest does not:
 *
 * - `protectionHeadersRule()` is a `next.config.ts` `headers()` rule whose
 *   source matches every path (pages, route handlers, build assets, error
 *   pages, redirects). It carries the headers that never change: HSTS, nosniff,
 *   framing, referrer and permissions. It is separate from the noindex rule
 *   (lib/searchIndexing.ts) and must not inherit its exclusions.
 * - `buildContentSecurityPolicy()` is called by `src/proxy.ts` for each page
 *   request with a new nonce.
 *
 * Origins that come from configuration are read from the same variables the
 * backend reads (`R2_PUBLIC_ENDPOINT_URL`, falling back to `R2_ENDPOINT_URL`);
 * the only hosts written here are the third-party ones in `EXTERNAL_SOURCES`.
 * `src/__tests__/protectionHeadersCoverage.test.ts` fails when a route is left
 * out of the rule.
 */

export type SecurityEnv = Record<string, string | undefined>;

/** One year. Not `preload`: that list cannot be undone from here. */
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

/** Every path, including `/`. */
export const PROTECTION_HEADER_SOURCE = "/:path*";

// pdf.js fetches the standard font files of a PDF from this CDN
// (components/shared/views/highlightQuote.ts, STANDARD_FONT_DATA_URL).
const PDF_FONT_ORIGIN = "https://unpkg.com";

// Google Drive's file chooser (lib/googlePicker.ts) loads a script from
// apis.google.com, which then frames docs.google.com and reads from Google's
// APIs. A named exception for a feature that is off until a Drive connector is
// configured. To confirm against Google's documentation before enabling it.
const GOOGLE_PICKER_FRAME_SOURCES = ["https://docs.google.com"] as const;
const GOOGLE_PICKER_CONNECT_SOURCES = ["https://*.googleapis.com", "https://apis.google.com"] as const;
const GOOGLE_PICKER_IMAGE_SOURCES = ["https://*.googleusercontent.com", "https://*.gstatic.com"] as const;

/** Every third-party host the policy names. */
export const EXTERNAL_SOURCES: readonly string[] = [
    PDF_FONT_ORIGIN,
    ...GOOGLE_PICKER_FRAME_SOURCES,
    ...GOOGLE_PICKER_CONNECT_SOURCES,
    ...GOOGLE_PICKER_IMAGE_SOURCES,
];

/**
 * The origin browsers upload to and download from with signed URLs, from the
 * variables the backend signs them with. `null` when none is set or it is not
 * an http(s) URL.
 */
export function storageOrigin(env: SecurityEnv): string | null {
    const raw = env.R2_PUBLIC_ENDPOINT_URL?.trim() || env.R2_ENDPOINT_URL?.trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
        return null;
    }
}

/** `LITT_CSP_REPORT_ONLY=true` makes the policy report violations instead of enforcing them. */
export function isCspReportOnly(env: SecurityEnv): boolean {
    const value = env.LITT_CSP_REPORT_ONLY?.trim().toLowerCase();
    return value === "1" || value === "true";
}

export function cspHeaderName(env: SecurityEnv): string {
    return isCspReportOnly(env) ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** A new, unguessable value for one request. */
export function newNonce(): string {
    return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The policy for one page request.
 *
 * - Scripts: the nonce (Next stamps it on its own scripts; `layout.tsx` stamps
 *   the two boot scripts) plus `'strict-dynamic'`, so a trusted script may load
 *   the ones it needs. No `'unsafe-inline'`; `'unsafe-eval'` only in development.
 *   `'wasm-unsafe-eval'` lets a trusted script compile WebAssembly, which the
 *   Word document viewer needs to lay out text; it does not allow `eval`.
 * - Styles keep `'unsafe-inline'`: the UI libraries set `style` attributes, and
 *   a nonce cannot cover those.
 * - Nothing may frame the app (`frame-ancestors 'none'`).
 */
export function buildContentSecurityPolicy({
    nonce,
    env,
    secure,
}: {
    nonce: string;
    env: SecurityEnv;
    secure: boolean;
}): string {
    const storage = storageOrigin(env);
    const development = env.NODE_ENV === "development";
    const directives: [string, string[]][] = [
        ["default-src", ["'self'"]],
        [
            "script-src",
            ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...(development ? ["'unsafe-eval'"] : [])],
        ],
        ["style-src", ["'self'", "'unsafe-inline'"]],
        ["img-src", ["'self'", "data:", "blob:", ...(storage ? [storage] : []), ...GOOGLE_PICKER_IMAGE_SOURCES]],
        ["font-src", ["'self'", "data:"]],
        [
            "connect-src",
            ["'self'", "blob:", ...(storage ? [storage] : []), PDF_FONT_ORIGIN, ...GOOGLE_PICKER_CONNECT_SOURCES],
        ],
        ["frame-src", [...GOOGLE_PICKER_FRAME_SOURCES]],
        ["worker-src", ["'self'", "blob:"]],
        ["object-src", ["'none'"]],
        ["base-uri", ["'self'"]],
        ["form-action", ["'self'"]],
        ["frame-ancestors", ["'none'"]],
        ...(secure ? ([["upgrade-insecure-requests", []]] as [string, string[]][]) : []),
    ];
    return directives.map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

/** The headers that do not change per request. Same values as word-addin/server.mjs, bar framing. */
export function staticProtectionHeaders(): { key: string; value: string }[] {
    return [
        { key: "Strict-Transport-Security", value: `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains` },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Features LiTT never uses. Clipboard stays allowed: the app copies text.
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ];
}

export function protectionHeadersRule(): { source: string; headers: { key: string; value: string }[] } {
    return { source: PROTECTION_HEADER_SOURCE, headers: staticProtectionHeaders() };
}

/**
 * Under /api the gateway relays what the backend answers, and the backend asks
 * for no referrer at all. A rule listed after the protection rule replaces its
 * header of the same name, so those answers keep the backend's value.
 */
export const API_HEADER_SOURCE = "/api/:path*";
export const API_REFERRER_POLICY = "no-referrer";

export function apiHeadersRule(): { source: string; headers: { key: string; value: string }[] } {
    return { source: API_HEADER_SOURCE, headers: [{ key: "Referrer-Policy", value: API_REFERRER_POLICY }] };
}

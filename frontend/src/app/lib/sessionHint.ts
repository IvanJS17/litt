/**
 * Does this request carry a LiTT session cookie? The public start page (`/`,
 * app/page.tsx) uses it on the server to write "Abrir LiTT" instead of
 * "Iniciar sesión" in the HTML itself, so the button never changes after the
 * page paints.
 *
 * It is a hint, not a check: the cookie is httpOnly and only the API can say
 * whether it is still valid. A stale one sends the person to /assistant,
 * which sends them on to /login, the same as any bookmark would. Nothing is
 * decided from it except the label and the destination of one link.
 *
 * The name is the one the API sets (backend/src/lib/authSession.ts): `mike-session`,
 * with the `__Host-` prefix in production, split into `.0`, `.1`… chunks when
 * the session is large.
 */
const AUTH_COOKIE_BASE_NAME = "mike-session";
const HOST_PREFIX = "__Host-";

export function hasSessionCookie(cookieNames: readonly string[]): boolean {
    return cookieNames.some((name) => {
        const base = name.startsWith(HOST_PREFIX) ? name.slice(HOST_PREFIX.length) : name;
        return (
            base === AUTH_COOKIE_BASE_NAME ||
            base.startsWith(`${AUTH_COOKIE_BASE_NAME}.`) ||
            base.startsWith(`${AUTH_COOKIE_BASE_NAME}-`)
        );
    });
}

// Redirect URI rules shared by registration, CIMD and /authorize.
//
// A registrable URI is https, or http on a loopback host (RFC 8252 §7.3:
// native clients such as Claude Code, Codex and Hermes listen on a free
// port). No fragments, no credentials. A request is matched against the
// registered set EXACTLY, except that a loopback request may use any port.

export const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2048;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
    if (uri.length > MAX_URI_LENGTH || /[\\\u0000-\u001f\u007f\s]/.test(uri)) return null;
    try {
        return new URL(uri);
    } catch {
        return null;
    }
}

export function isLoopbackRedirect(uri: string): boolean {
    const url = parse(uri);
    return !!url && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

export function isRegistrableRedirectUri(uri: unknown): uri is string {
    if (typeof uri !== "string") return false;
    const url = parse(uri);
    if (!url || url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return !!url.hostname;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Validate a list; returns the list, or null when any entry is unusable. */
export function validRedirectUris(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS)
        return null;
    return value.every(isRegistrableRedirectUri) ? [...new Set(value as string[])] : null;
}

export function redirectUriAllowed(registered: readonly string[], requested: string): boolean {
    if (registered.includes(requested)) return true;
    const wanted = parse(requested);
    if (!wanted || wanted.protocol !== "http:" || !LOOPBACK_HOSTS.has(wanted.hostname))
        return false;
    return registered.some((candidate) => {
        const url = parse(candidate);
        return (
            !!url &&
            url.protocol === "http:" &&
            url.hostname === wanted.hostname &&
            url.pathname === wanted.pathname &&
            url.search === wanted.search
        );
    });
}

/** What the consent page shows as "where you will be sent back to". */
export function redirectDisplayHost(uri: string): string {
    const url = parse(uri);
    return url ? url.host.replace(/:\d+$/, (port) => (isLoopbackRedirect(uri) ? "" : port)) : "";
}

/**
 * Connection-level failures: the Next server could not reach the backend at
 * all (stopped, restarting, wrong host, network down). Node's fetch reports
 * every one of them as the same `TypeError: fetch failed`; the real code sits
 * on its `cause`, or on each entry of an AggregateError when several
 * addresses were tried. A response that arrived late (UND_ERR_HEADERS_TIMEOUT)
 * is deliberately not here: that backend is up, only slow.
 */
const UNREACHABLE_CODES = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
]);

/**
 * The connection-level code behind an upstream fetch failure, or null when
 * the failure is anything else. Walks `cause`, `lastError` and AggregateError
 * `errors` through a bounded, allowlisted walk, so no message text is ever
 * read and only a known connection code can come back.
 */
export function upstreamUnreachableCode(error: unknown): string | null {
    const pending: unknown[] = [error];
    const seen = new Set<object>();
    for (let n = 0; pending.length && n < 12; n++) {
        const candidate = pending.shift();
        if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        try {
            const item = candidate as {
                code?: unknown;
                name?: unknown;
                cause?: unknown;
                lastError?: unknown;
                errors?: unknown;
            };
            for (const code of [item.code, item.name]) {
                if (typeof code === "string" && UNREACHABLE_CODES.has(code)) {
                    return code;
                }
            }
            if (item.cause) pending.push(item.cause);
            if (item.lastError) pending.push(item.lastError);
            if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 5));
        } catch {
            // Host objects/proxies may have throwing accessors; the gateway's
            // answer must not throw while classifying a failure.
        }
    }
    return null;
}

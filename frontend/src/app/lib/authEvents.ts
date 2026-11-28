export const AUTH_SESSION_INVALIDATED_EVENT = "mike:auth-session-invalidated";
/** Any request the server refused because the current Terms are not accepted yet. */
export const TERMS_ACCEPTANCE_REQUIRED_EVENT = "litt:terms-acceptance-required";

/**
 * Fetch an authenticated application resource and immediately invalidate the
 * browser's in-memory auth state when the backend rejects the session.
 */
export async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    const response = await globalThis.fetch(input, {
        ...init,
        credentials: "include",
    });

    if (response.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_SESSION_INVALIDATED_EVENT));
    }

    if (response.status === 403 && typeof window !== "undefined") {
        // Read a copy: the caller still reads the body itself.
        const body = await response
            .clone()
            .json()
            .catch(() => null);
        if (body?.code === "terms_acceptance_required") {
            window.dispatchEvent(new Event(TERMS_ACCEPTANCE_REQUIRED_EVENT));
        }
    }

    return response;
}

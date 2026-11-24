import { clientTranslator } from "@mike/client";
const AUTH_REDIRECT_PATHS = new Set([
    "/assistant",
    // An app asking to connect to the account; the person signs in first.
    "/connect/authorize",
    "/login",
    "/reset-password",
    "/settings",
    "/onboarding/profile",
    "/onboarding/practice",
    "/onboarding/invitations",
    "/onboarding/models",
]);

export function safeAuthNext(
    candidate: string | null | undefined,
    fallback = "/assistant",
): string {
    if (
        !candidate ||
        !candidate.startsWith("/") ||
        candidate.startsWith("//")
    ) {
        return fallback;
    }
    if (candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) {
        return fallback;
    }

    const base = new URL("https://auth.mike.local");
    const resolved = new URL(candidate, base);
    if (
        resolved.origin !== base.origin ||
        !AUTH_REDIRECT_PATHS.has(resolved.pathname)
    ) {
        return fallback;
    }
    return `${resolved.pathname}${resolved.search}`;
}

/**
 * A `?next=` value that may name any page of this application, for readers
 * that carry the person back to where they were (the second-factor step).
 * Anything that is not a plain same-origin path falls back.
 */
export function safeSameOriginPath(
    candidate: string | null | undefined,
    fallback = "/assistant",
): string {
    if (
        !candidate ||
        !candidate.startsWith("/") ||
        candidate.startsWith("//") ||
        candidate.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(candidate)
    ) {
        return fallback;
    }
    const base = new URL("https://auth.mike.local");
    const resolved = new URL(candidate, base);
    if (
        resolved.origin !== base.origin ||
        resolved.pathname.startsWith("//") ||
        resolved.pathname.startsWith("/\\") ||
        resolved.pathname === "/verify-mfa" ||
        resolved.pathname.startsWith("/verify-mfa/")
    ) {
        return fallback;
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function authErrorDescription(
    search: string,
    hash: string,
): string | null {
    const query = new URLSearchParams(search);
    const fragment = new URLSearchParams(hash.replace(/^#/, ""));
    const error = (
        query.get("error_description") ||
        query.get("error") ||
        fragment.get("error_description") ||
        fragment.get("error")
    );
    if (!error) return null;
    if (/expired|invalid/i.test(error)) {
        return clientTranslator()("auth.errors.confirmationLinkInvalid");
    }
    if (/access.denied|cancel/i.test(error)) {
        return clientTranslator()("auth.errors.authCancelled");
    }
    return clientTranslator()("auth.errors.authIncomplete");
}

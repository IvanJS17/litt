import { NextResponse, type NextRequest } from "next/server";
import {
    buildContentSecurityPolicy,
    cspHeaderName,
    newNonce,
    staticProtectionHeaders,
} from "@/app/lib/securityHeaders";

// The old account address and everything under it live in /settings. These are
// here and not in next.config.ts `redirects()` because Next answers those
// without the `headers()` rules.
const MOVED_ACCOUNT = /^\/account(\/.*)?$/;

/**
 * Sets the content security policy of each page request, with a nonce of its
 * own (lib/securityHeaders.ts). Next reads the nonce from the request's policy
 * and stamps it on its scripts; `layout.tsx` reads `x-nonce` for the boot
 * script. The headers that do not change per request are the `headers()` rule
 * in next.config.ts, which also covers the paths left out below.
 */
export function proxy(request: NextRequest) {
    const moved = MOVED_ACCOUNT.exec(request.nextUrl.pathname);
    if (moved) {
        const target = request.nextUrl.clone();
        target.pathname = `/settings${moved[1] ?? ""}`;
        const redirect = NextResponse.redirect(target, 308);
        for (const { key, value } of staticProtectionHeaders()) redirect.headers.set(key, value);
        return redirect;
    }
    const nonce = newNonce();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const secure = forwardedProto === "https" || request.nextUrl.protocol === "https:";
    const name = cspHeaderName(process.env);
    const policy = buildContentSecurityPolicy({ nonce, env: process.env, secure });

    // A policy or nonce the caller sent is never the one the page renders with.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("content-security-policy");
    requestHeaders.delete("content-security-policy-report-only");
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set(name, policy);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set(name, policy);
    return response;
}

export const config = {
    // Everything but the API gateway (a proxy on a route buffers the request
    // body, and uploads and downloads stream through it; the backend sends its
    // own policy), the build's static files and the image optimizer, which are
    // not pages. `/api/` alone and a path that only starts like the optimizer's
    // are answered with the not-found page, so they are not left out.
    matcher: ["/((?!api/.|_next/static/|_next/image$).*)"],
};

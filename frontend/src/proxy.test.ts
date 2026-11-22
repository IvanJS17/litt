// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staticProtectionHeaders } from "@/app/lib/securityHeaders";
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

const request = (headers: Record<string, string> = {}, url = "https://app.example.test/login") =>
    new NextRequest(url, { headers });

describe("the proxy sets the policy for each request", () => {
    it("sends a policy whose nonce is the one the page reads", () => {
        const response = proxy(request());
        const csp = response.headers.get("content-security-policy")!;
        const nonce = /'nonce-([^']+)'/.exec(csp)![1];
        expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
        expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    });

    it("uses a new nonce for each request", () => {
        const a = proxy(request()).headers.get("content-security-policy");
        const b = proxy(request()).headers.get("content-security-policy");
        expect(a).not.toBe(b);
    });

    it("ignores a nonce or policy the caller sends", () => {
        const response = proxy(request({ "x-nonce": "sent-by-the-client", "content-security-policy": "default-src *" }));
        const csp = response.headers.get("content-security-policy")!;
        expect(csp).not.toContain("sent-by-the-client");
        expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe("sent-by-the-client");
    });

    it("upgrades insecure requests behind an HTTPS edge", () => {
        const secure = proxy(request({ "x-forwarded-proto": "https" }, "http://litt:3000/login"));
        expect(secure.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
        const plain = proxy(request({}, "http://localhost:3000/login"));
        expect(plain.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    });

    it("only reports when the environment switch says so", () => {
        vi.stubEnv("LITT_CSP_REPORT_ONLY", "true");
        const response = proxy(request());
        expect(response.headers.get("content-security-policy")).toBeNull();
        expect(response.headers.get("content-security-policy-report-only")).toContain("frame-ancestors 'none'");
        expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toContain("'nonce-");
    });

    it("reads storage from configuration at request time", () => {
        vi.stubEnv("R2_PUBLIC_ENDPOINT_URL", "https://storage.example.test");
        expect(proxy(request()).headers.get("content-security-policy")).toContain("connect-src 'self' blob: https://storage.example.test");
    });
});

// Next's own `redirects()` answer without the `headers()` rules, so the two
// permanent redirects live here, where the headers are set on the redirect too.
describe("the permanent redirect from /account to /settings", () => {
    it("moves /account and everything under it, keeping the query", () => {
        const root = proxy(request({}, "https://app.example.test/account"));
        expect(root.status).toBe(308);
        expect(new URL(root.headers.get("location")!).pathname).toBe("/settings");
        const deep = proxy(request({}, "https://app.example.test/account/security?tab=mfa"));
        const target = new URL(deep.headers.get("location")!);
        expect([target.pathname, target.search]).toEqual(["/settings/security", "?tab=mfa"]);
    });

    it("carries the protection headers", () => {
        const response = proxy(request({}, "https://app.example.test/account"));
        for (const { key, value } of staticProtectionHeaders()) expect(response.headers.get(key)).toBe(value);
    });

    it("leaves other paths that start with the same letters alone", () => {
        for (const path of ["/account-deleted", "/accounts", "/accountant/x"]) {
            expect(proxy(request({}, `https://app.example.test${path}`)).status).toBe(200);
        }
    });
});

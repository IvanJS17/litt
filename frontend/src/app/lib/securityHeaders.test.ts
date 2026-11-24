import { describe, expect, it } from "vitest";
import {
    EXTERNAL_SOURCES,
    HSTS_MAX_AGE_SECONDS,
    buildContentSecurityPolicy,
    cspHeaderName,
    isCspReportOnly,
    newNonce,
    staticProtectionHeaders,
    storageOrigin,
} from "@/app/lib/securityHeaders";

function directives(policy: string): Map<string, string[]> {
    return new Map(
        policy
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const [name, ...sources] = part.split(/\s+/);
                return [name, sources] as const;
            }),
    );
}

const policy = (env: Record<string, string | undefined> = {}, secure = true) =>
    directives(buildContentSecurityPolicy({ nonce: "bm9uY2U=", env, secure }));

describe("content security policy", () => {
    it("lets only nonced scripts run, and no inline or eval script in production", () => {
        const scripts = policy({ NODE_ENV: "production" }).get("script-src")!;
        expect(scripts).toEqual(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
    });

    it("lets the document viewers compile their WebAssembly, which is not script eval", () => {
        // The Word document viewer shapes text with a WebAssembly module; a
        // browser refuses to compile one unless the policy says so.
        for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "development" }, {}]) {
            expect(policy(env).get("script-src")).toContain("'wasm-unsafe-eval'");
        }
        expect(policy({ NODE_ENV: "production" }).get("script-src")).not.toContain("'unsafe-eval'");
    });

    it("allows eval only in development", () => {
        expect(policy({ NODE_ENV: "development" }).get("script-src")).toContain("'unsafe-eval'");
        expect(policy({ NODE_ENV: "production" }).get("script-src")).not.toContain("'unsafe-eval'");
        expect(policy({}).get("script-src")).not.toContain("'unsafe-eval'");
    });

    it("closes plugins, base tag, form targets and framing", () => {
        const csp = policy();
        expect(csp.get("default-src")).toEqual(["'self'"]);
        expect(csp.get("object-src")).toEqual(["'none'"]);
        expect(csp.get("base-uri")).toEqual(["'self'"]);
        expect(csp.get("form-action")).toEqual(["'self'"]);
        expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    });

    it("says plainly that styles keep unsafe-inline", () => {
        expect(policy().get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    });

    it("lets the viewers run their workers and show blob and data images", () => {
        const csp = policy();
        expect(csp.get("worker-src")).toEqual(["'self'", "blob:"]);
        expect(csp.get("img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:"]));
        expect(csp.get("font-src")).toEqual(expect.arrayContaining(["'self'"]));
    });

    it("upgrades insecure requests only on a secure request", () => {
        expect(policy({}, true).has("upgrade-insecure-requests")).toBe(true);
        expect(policy({}, false).has("upgrade-insecure-requests")).toBe(false);
    });

    it("allows the storage origin from configuration for uploads and images", () => {
        const csp = policy({
            R2_ENDPOINT_URL: "https://internal.example.test",
            R2_PUBLIC_ENDPOINT_URL: "https://storage.example.test/some/path?x=1",
        });
        expect(csp.get("connect-src")).toContain("https://storage.example.test");
        expect(csp.get("img-src")).toContain("https://storage.example.test");
        expect(csp.get("connect-src")).not.toContain("https://internal.example.test");
    });

    it("falls back to the server-side endpoint when there is no public one", () => {
        expect(storageOrigin({ R2_ENDPOINT_URL: "https://acct.r2.example.test" })).toBe("https://acct.r2.example.test");
        expect(storageOrigin({ R2_PUBLIC_ENDPOINT_URL: "  ", R2_ENDPOINT_URL: "http://localhost:9000" })).toBe("http://localhost:9000");
    });

    it("ignores a storage value that is not an http(s) origin", () => {
        expect(storageOrigin({})).toBeNull();
        expect(storageOrigin({ R2_PUBLIC_ENDPOINT_URL: "not a url" })).toBeNull();
        expect(storageOrigin({ R2_PUBLIC_ENDPOINT_URL: "ftp://files.example.test" })).toBeNull();
        expect(storageOrigin({ R2_PUBLIC_ENDPOINT_URL: "javascript:alert(1)" })).toBeNull();
    });

    it("names no host except configuration and the explicit external sources", () => {
        const text = buildContentSecurityPolicy({ nonce: "bm9uY2U=", env: {}, secure: true });
        const hosts = text.match(/https?:\/\/[^\s;]+/g) ?? [];
        expect(hosts.length).toBeGreaterThan(0);
        for (const host of hosts) expect(EXTERNAL_SOURCES).toContain(host);
        expect(text).not.toMatch(/asteroitt|litt\./i);
        // The viewers' fonts come from the app's own origin: no font host, and
        // no script/CDN host either.
        expect(EXTERNAL_SOURCES.join(" ")).not.toMatch(/unpkg|jsdelivr|cdnjs/i);
        expect(text).not.toMatch(/unpkg|jsdelivr|cdnjs/i);
        const directive = (name: string) =>
            text.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
        expect(directive("font-src")).toBe("font-src 'self' data:");
        expect(directive("connect-src")).not.toMatch(/unpkg/);
    });
});

describe("the report-only switch", () => {
    it("enforces by default", () => {
        for (const value of [undefined, "", "0", "false", "no"]) {
            expect(isCspReportOnly({ LITT_CSP_REPORT_ONLY: value })).toBe(false);
        }
        expect(cspHeaderName({})).toBe("Content-Security-Policy");
    });

    it("only reports when asked", () => {
        for (const value of ["1", "true", "TRUE", " true "]) {
            expect(isCspReportOnly({ LITT_CSP_REPORT_ONLY: value })).toBe(true);
            expect(cspHeaderName({ LITT_CSP_REPORT_ONLY: value })).toBe("Content-Security-Policy-Report-Only");
        }
    });
});

describe("the headers every response carries", () => {
    const headers = new Map(staticProtectionHeaders().map(({ key, value }) => [key, value]));

    it("keeps HTTPS for at least a year on every subdomain, without preload", () => {
        expect(HSTS_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(31536000);
        const value = headers.get("Strict-Transport-Security")!;
        expect(value).toBe(`max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`);
        expect(value).not.toMatch(/preload/i);
    });

    it("blocks sniffing, framing by other sites and cross-site referrers", () => {
        expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(headers.get("X-Frame-Options")).toBe("DENY");
        expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    });

    it("denies only the features the app never uses", () => {
        const value = headers.get("Permissions-Policy")!;
        for (const feature of ["camera", "microphone", "geolocation"]) expect(value).toContain(`${feature}=()`);
        expect(value).not.toMatch(/clipboard/);
    });

    it("carries no policy of its own (the policy needs a nonce per request)", () => {
        expect([...headers.keys()].map((k) => k.toLowerCase())).not.toContain("content-security-policy");
    });
});

describe("nonces", () => {
    it("are unguessable and new each time", () => {
        const first = newNonce();
        expect(first).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
        expect(newNonce()).not.toBe(first);
    });
});

// The browser protection headers must reach every response the web app sends.
// The routes come from the file system (not from a list kept by hand), so a new
// page or route handler is checked the day it is added, and a narrower source
// or an exclusion on the protection rule fails here.
//
// Matching uses Next's own matcher (`next/dist/shared/lib/router/utils/path-match`,
// the path-to-regexp build the router resolves `headers()` and `redirects()`
// sources with), also for the proxy's matcher, which Next compiles on its own:
// that one tells upper case from lower case and this one does not, so this test
// can only take more paths for left out than Next does. What this cannot see:
// whether Next really sends the headers on each response (the HTTP check against
// `next start` covers that), and responses the backend or a reverse proxy adds
// or changes after Next.
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import { PUBLIC_INDEXABLE_PATHS, noindexHeaderSource } from "@/app/lib/searchIndexing";
import { API_HEADER_SOURCE, API_REFERRER_POLICY, staticProtectionHeaders } from "@/app/lib/securityHeaders";
import { config as proxyConfig } from "@/proxy";
import nextConfig from "../../next.config";

const FRONTEND = resolve(__dirname, "../..");
const APP = join(FRONTEND, "src", "app");
const PUBLIC = join(FRONTEND, "public");

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

/** `(group)` folders vanish; `[id]` becomes a value; `[...path]` becomes two segments. */
function routeOf(file: string): string {
    const segments = relative(APP, file)
        .split(sep)
        .slice(0, -1)
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .flatMap((segment) => {
            if (/^\[\.\.\..+\]$/.test(segment)) return ["any", "thing"];
            if (/^\[.+\]$/.test(segment)) return ["value"];
            return [segment];
        });
    return `/${segments.join("/")}`;
}

const appFiles = walk(APP).filter((file) => !/\.test\.|__tests__|stories/.test(file));
const pageRoutes = appFiles.filter((f) => /[\\/]page\.tsx$/.test(f)).map(routeOf);
const handlerRoutes = appFiles.filter((f) => /[\\/]route\.ts$/.test(f)).map(routeOf);
const publicFiles = walk(PUBLIC).map((file) => `/${relative(PUBLIC, file).split(sep).join("/")}`);

// Next serves these file conventions at fixed paths.
const metadataRoutes = ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/icon.svg", "/favicon.ico"];

const everyRoute = [
    ...new Set([
        ...pageRoutes,
        ...handlerRoutes,
        ...metadataRoutes,
        ...publicFiles,
        // The pages the noindex rule leaves out, with and without a slash.
        ...PUBLIC_INDEXABLE_PATHS,
        "/privacidad/",
        "/terminos/",
        // Static assets, the image optimizer, a 404 and the permanent redirects.
        "/_next/static/chunks/app/page-0123abcd.js",
        "/_next/static/media/inter.0123abcd.woff2",
        "/_next/image",
        // Not the gateway nor the optimizer: these answer with the not-found page.
        "/api/",
        "/_next/imagefoo",
        "/_next/image/foo",
        "/_next/static",
        "/_next/staticfoo",
        "/this/page/does/not/exist",
        "/account",
        "/account/security",
        "/connect/authorize",
    ]),
];

const matches = (source: string, path: string) => Boolean(getPathMatch(source)(path));

async function headerRules() {
    const resolved = await nextConfig("phase-production-server");
    return resolved.headers!();
}

describe("the route list", () => {
    it("really enumerates the application", () => {
        expect(pageRoutes).toEqual(expect.arrayContaining(["/", "/login", "/connect/authorize", "/settings", "/privacidad", "/terminos"]));
        expect(handlerRoutes).toEqual(["/api/any/thing"]);
        expect(everyRoute.length).toBeGreaterThan(80);
    });

    it("includes the pages the noindex rule excludes, and they are really excluded from it", () => {
        for (const path of ["/", "/privacidad", "/terminos", "/privacidad/", "/terminos/"]) {
            expect(everyRoute).toContain(path);
            expect(matches(noindexHeaderSource(), path)).toBe(false);
        }
        expect(matches(noindexHeaderSource(), "/login")).toBe(true);
    });
});

describe("the protection headers rule", () => {
    it("is one rule, separate from the noindex rule, with no conditions", async () => {
        const rules = await headerRules();
        const protection = rules.filter((rule) => rule.headers.some((h) => h.key === "Strict-Transport-Security"));
        expect(protection).toHaveLength(1);
        const [rule] = protection;
        expect(rule.headers.some((h) => h.key === "X-Robots-Tag")).toBe(false);
        expect(rule.source).not.toBe(noindexHeaderSource());
        expect(rule).not.toHaveProperty("has");
        expect(rule).not.toHaveProperty("missing");
        expect(rule).not.toHaveProperty("locale");
        expect(rule).not.toHaveProperty("basePath");
    });

    it("carries every non-policy header", async () => {
        const rules = await headerRules();
        const rule = rules.find((r) => r.headers.some((h) => h.key === "Strict-Transport-Security"))!;
        expect(rule.headers).toEqual(staticProtectionHeaders());
    });

    it("matches every page, route handler, asset, error page and redirect", async () => {
        const rules = await headerRules();
        const rule = rules.find((r) => r.headers.some((h) => h.key === "Strict-Transport-Security"))!;
        const missed = everyRoute.filter((path) => !matches(rule.source, path));
        expect(missed).toEqual([]);
    });
});

describe("what the backend answers through the API gateway", () => {
    // Rules apply in order and a later one replaces an earlier header of the same name.
    async function referrerPolicyFor(path: string) {
        let value: string | undefined;
        for (const rule of await headerRules()) {
            if (!matches(rule.source, path)) continue;
            for (const header of rule.headers) if (header.key === "Referrer-Policy") value = header.value;
        }
        return value;
    }

    it("keeps the backend's own referrer policy", async () => {
        for (const path of ["/api/any/thing", "/api/health", "/api/user/integrations/gmail/oauth/callback", "/api/"]) {
            expect(await referrerPolicyFor(path)).toBe(API_REFERRER_POLICY);
        }
        expect(API_REFERRER_POLICY).toBe("no-referrer");
    });

    it("leaves the pages with the web's referrer policy", async () => {
        for (const path of ["/", "/login", "/connect/authorize", "/settings", "/apiary", "/this/page/does/not/exist"]) {
            expect(await referrerPolicyFor(path)).toBe("strict-origin-when-cross-origin");
        }
    });

    it("is a rule with no conditions that sets nothing else", async () => {
        const rules = await headerRules();
        const api = rules.filter((rule) => rule.source === API_HEADER_SOURCE);
        expect(api).toHaveLength(1);
        expect(api[0].headers).toEqual([{ key: "Referrer-Policy", value: API_REFERRER_POLICY }]);
        expect(api[0]).not.toHaveProperty("has");
        expect(api[0]).not.toHaveProperty("missing");
        // After the protection rule: the order decides which value is sent.
        const protection = rules.findIndex((rule) => rule.headers.some((h) => h.key === "Strict-Transport-Security"));
        expect(rules.indexOf(api[0])).toBeGreaterThan(protection);
    });
});

describe("the policy rule (proxy)", () => {
    const sources = (proxyConfig.matcher as { source: string }[] | string[]).map((entry) =>
        typeof entry === "string" ? entry : entry.source,
    );
    const policyReaches = (path: string) => sources.some((source) => matches(source, path));

    // What is not a page: a path under the API gateway, a build asset, the image optimizer itself.
    const notAPage = (path: string) => /^\/api\/./.test(path) || path.startsWith("/_next/static/") || path === "/_next/image";

    it("reaches every page and the 404 and redirect responses", () => {
        expect(everyRoute.filter((path) => !notAPage(path) && !policyReaches(path))).toEqual([]);
    });

    it("leaves out only the API gateway and the build assets", () => {
        const left = everyRoute.filter((path) => !policyReaches(path));
        expect(left.every(notAPage)).toBe(true);
        expect(left.length).toBeGreaterThan(0);
    });
});

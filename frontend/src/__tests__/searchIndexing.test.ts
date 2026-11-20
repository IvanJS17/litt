import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
    NOINDEX_DIRECTIVE,
    PUBLIC_INDEXABLE_PATHS,
    PUBLIC_RESOURCE_PATHS,
    isPublicIndexablePath,
} from "@/app/lib/searchIndexing";
import { SITE_URL } from "@/app/lib/siteUrl";

type RobotsRules = { userAgent: string; allow: string[]; disallow: string };

/**
 * Google's robots.txt matching: the longest matching rule wins; a tie
 * between an allow and a disallow of equal length favors allow. A `$`
 * anchors a rule to an exact path; otherwise it matches as a prefix. No
 * matching rule means allowed (robots.txt is an exclusion list).
 */
function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
    const candidates = [...rules.allow.map((pattern) => ({ allow: true, pattern })), { allow: false, pattern: rules.disallow }];
    const matches = candidates.filter(({ pattern }) =>
        pattern.endsWith("$") ? path === pattern.slice(0, -1) : path.startsWith(pattern),
    );
    if (matches.length === 0) return true;
    matches.sort((a, b) => b.pattern.length - a.pattern.length || (a.allow ? -1 : 1));
    return matches[0].allow;
}

// Invitation-only beta: PUBLIC_INDEXABLE_PATHS may be listed by search
// engines and AI crawlers; every other path keeps asking them not to.
describe("search indexing: the public pages are listed, nothing else is", () => {
    it("is exactly the start page and the two legal pages", () => {
        expect(PUBLIC_INDEXABLE_PATHS).toEqual(["/", "/privacidad", "/terminos"]);
    });

    it("isPublicIndexablePath matches only exact paths, not prefixes", () => {
        for (const path of PUBLIC_INDEXABLE_PATHS) expect(isPublicIndexablePath(path)).toBe(true);
        expect(isPublicIndexablePath("/login")).toBe(false);
        expect(isPublicIndexablePath("/privacidad/")).toBe(false);
        expect(isPublicIndexablePath("/privacidad/anything")).toBe(false);
    });

    it("robots.txt allows exactly the public paths and resources, and disallows the rest", () => {
        expect(robots()).toEqual({
            rules: {
                userAgent: "*",
                allow: ["/$", "/privacidad$", "/terminos$", ...PUBLIC_RESOURCE_PATHS],
                disallow: "/",
            },
            sitemap: `${SITE_URL}/sitemap.xml`,
        });
    });

    it("lets a renderer-based crawler fetch the assets the public pages need, but not app routes", () => {
        const rules = robots().rules as RobotsRules;
        for (const resource of [
            "/_next/static/chunks/123.js",
            "/_next/static/css/abc.css",
            "/_next/static/media/inter-latin.woff2",
            "/favicon.ico",
            "/icon.svg",
            "/apple-touch-icon.png",
            "/link-image.jpg",
            "/robots.txt",
            "/sitemap.xml",
        ]) {
            expect(isAllowedByRobots(resource, rules), resource).toBe(true);
        }
        for (const blocked of ["/login", "/app", "/api/x", "/settings", "/assistant", "/privacidad/x"]) {
            expect(isAllowedByRobots(blocked, rules), blocked).toBe(false);
        }
    });

    it("the sitemap lists exactly the public paths", () => {
        expect(sitemap()).toEqual([
            { url: SITE_URL },
            { url: `${SITE_URL}/privacidad` },
            { url: `${SITE_URL}/terminos` },
        ]);
    });

    it("every response outside the public pages carries X-Robots-Tag: noindex", async () => {
        process.env.GIT_SHA ??= "0".repeat(40);
        const { default: config } = await import("../../next.config");
        const resolved = await config("phase-development-server");
        const rules = await resolved.headers!();
        const [rule] = rules as { source: string; headers: { key: string; value: string }[] }[];
        expect(rule.headers).toEqual([{ key: "X-Robots-Tag", value: NOINDEX_DIRECTIVE }]);
        // Exercise the generated source the way Next itself resolves it.
        // @ts-expect-error -- Next ships no .d.ts for its vendored path-to-regexp.
        const { pathToRegexp } = await import("next/dist/compiled/path-to-regexp");
        const compiled: RegExp = pathToRegexp(rule.source);
        for (const path of [...PUBLIC_INDEXABLE_PATHS, "/privacidad/", "/terminos/"]) {
            expect(compiled.test(path)).toBe(false);
        }
        for (const path of ["/login", "/signup", "/assistant", "/api/health", "/privacidad/x", "/terminos/sub"]) {
            expect(compiled.test(path)).toBe(true);
        }
    });

    it("the Cloudflare headers file unsets the blanket noindex on the public pages instead of overriding it", () => {
        const file = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
        expect(file).toMatch(/^\/\*\n\s+X-Robots-Tag: noindex, nofollow$/m);
        for (const path of PUBLIC_INDEXABLE_PATHS) {
            const pattern = new RegExp(`^${path.replace("/", "\\/")}\\n\\s+! X-Robots-Tag$`, "m");
            expect(file).toMatch(pattern);
        }
        expect(file).not.toContain("X-Robots-Tag: index, follow");
    });

    it("has no static robots.txt or sitemap.xml that would shadow the routes", () => {
        expect(existsSync(resolve(__dirname, "../../public/robots.txt"))).toBe(false);
        expect(existsSync(resolve(__dirname, "../../public/sitemap.xml"))).toBe(false);
    });
});

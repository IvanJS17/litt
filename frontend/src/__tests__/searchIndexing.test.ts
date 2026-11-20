import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { NOINDEX_DIRECTIVE, PUBLIC_INDEXABLE_PATHS, isPublicIndexablePath } from "@/app/lib/searchIndexing";
import { SITE_URL } from "@/app/lib/siteUrl";

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

    it("robots.txt allows exactly the public paths and disallows the rest", () => {
        expect(robots()).toEqual({
            rules: { userAgent: "*", allow: ["/$", "/privacidad$", "/terminos$"], disallow: "/" },
            sitemap: `${SITE_URL}/sitemap.xml`,
        });
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

    it("the Cloudflare headers file keeps the public pages out of its blanket noindex", () => {
        const file = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
        expect(file).toMatch(/^\/\*\n\s+X-Robots-Tag: noindex, nofollow$/m);
        for (const path of PUBLIC_INDEXABLE_PATHS) {
            const pattern = new RegExp(`^${path.replace("/", "\\/")}\\n\\s+X-Robots-Tag: index, follow$`, "m");
            expect(file).toMatch(pattern);
        }
    });

    it("has no static robots.txt or sitemap.xml that would shadow the routes", () => {
        expect(existsSync(resolve(__dirname, "../../public/robots.txt"))).toBe(false);
        expect(existsSync(resolve(__dirname, "../../public/sitemap.xml"))).toBe(false);
    });
});

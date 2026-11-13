import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { NOINDEX_DIRECTIVE, SEARCH_INDEXING_ALLOWED } from "@/app/lib/searchIndexing";

// Closed beta: LiTT is not listed by search engines. Lifting this is one
// commit; docs/search-indexing.md says which.
describe("search indexing is off while the beta is closed", () => {
    it("has the switch off", () => {
        expect(SEARCH_INDEXING_ALLOWED).toBe(false);
    });

    it("robots.txt turns every crawler away", () => {
        expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    });

    it("every response carries X-Robots-Tag: noindex", async () => {
        process.env.GIT_SHA ??= "0".repeat(40);
        const { default: config } = await import("../../next.config");
        const resolved = await config("phase-development-server");
        const rules = await resolved.headers!();
        expect(rules).toContainEqual({
            source: "/:path*",
            headers: [{ key: "X-Robots-Tag", value: NOINDEX_DIRECTIVE }],
        });
    });

    it("the Cloudflare headers file says the same", () => {
        const file = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
        expect(file).toMatch(/^\/\*\n\s+X-Robots-Tag: noindex, nofollow$/m);
    });

    it("has no static robots.txt that would shadow the route", () => {
        expect(existsSync(resolve(__dirname, "../../public/robots.txt"))).toBe(false);
    });
});

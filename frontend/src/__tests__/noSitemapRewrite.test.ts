import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// /sitemap.xml was rewritten to the upstream project's API, which does not
// exist here: every crawler got "Cannot GET /sitemap/sitemap.xml". Until there
// is a sitemap of our own, the path is just a 404 of the app.
it("next.config does not rewrite sitemap URLs to the API", () => {
    const config = readFileSync(resolve(__dirname, "../../next.config.ts"), "utf8");
    expect(config).not.toMatch(/sitemap/i);
    expect(config).not.toContain("async rewrites");
});

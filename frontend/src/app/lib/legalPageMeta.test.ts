import { describe, expect, it, vi } from "vitest";
import { legalPageMeta } from "./legalPageMeta";

vi.mock("next-intl/server", () => ({
    getTranslations: async (namespace: string) => (key: string) => `${namespace}:${key}`,
}));

// The two public legal pages (/privacidad, /terminos) are in
// PUBLIC_INDEXABLE_PATHS (searchIndexing.ts): each overrides the root
// layout's default noindex and sets its own canonical, the same way the
// start page's own generateMetadata does (page.test.tsx).
describe("legalPageMeta", () => {
    it("reads the title and description from the given key, and is indexable", async () => {
        const meta = await legalPageMeta("privacy", "/privacidad")();
        expect(meta.title).toBe("common.pageTitle:privacy");
        expect(meta.description).toBe("common.pageDescription:privacy");
        expect(meta.alternates).toEqual({ canonical: "https://litt.asteroitt.com/privacidad" });
        expect(meta.robots).toEqual({ index: true, follow: true });
    });

    it("builds the canonical from the given path, for the terms page too", async () => {
        const meta = await legalPageMeta("terms", "/terminos")();
        expect(meta.title).toBe("common.pageTitle:terms");
        expect(meta.description).toBe("common.pageDescription:terms");
        expect(meta.alternates).toEqual({ canonical: "https://litt.asteroitt.com/terminos" });
        expect(meta.robots).toEqual({ index: true, follow: true });
    });
});

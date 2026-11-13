import { describe, expect, it, vi } from "vitest";
import { isLegalPath } from "./legalRoutes";
import { pageTitle } from "./pageTitle";

vi.mock("next-intl/server", () => ({
    getTranslations: async (namespace: string) => (key: string) => `${namespace}:${key}`,
}));

describe("pageTitle", () => {
    it("is the metadata of a screen: its name from the catalog, for the root template to finish", async () => {
        await expect(pageTitle("settings")()).resolves.toEqual({ title: "common.pageTitle:settings" });
    });
});

describe("isLegalPath", () => {
    it.each(["/terminos", "/privacidad", "/terminos/"])("%s is a legal text", (path) => {
        expect(isLegalPath(path)).toBe(true);
    });

    it.each(["/assistant", "/terminos-extra", "", null, undefined])("%s is not", (path) => {
        expect(isLegalPath(path)).toBe(false);
    });
});

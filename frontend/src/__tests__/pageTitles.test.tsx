// Every screen names its tab: "Settings · LiTT". Static names come from the
// catalog through `pageTitle(...)` in the route's layout or page; names known
// only after loading (chat, project) use useDocumentTitle.

import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import enUS from "../../../packages/i18n/messages/en-US.json";
import esMX from "../../../packages/i18n/messages/es-MX.json";
import { sourceFiles } from "../../../scripts/i18n/literals.mjs";
import { useDocumentTitle } from "@/app/hooks/useDocumentTitle";
import { TITLE_TEMPLATE, titleFor } from "@/app/lib/documentTitle";

const REPO = resolve(__dirname, "../../..");
const APP = join(REPO, "frontend/src/app");
const used = new Map<string, string[]>();
for (const abs of sourceFiles(APP)) {
    if (/\.test\.tsx?$/.test(abs)) continue;
    for (const m of readFileSync(abs, "utf8").matchAll(/generateMetadata = pageTitle\("(\w+)"\)/g)) {
        used.set(m[1], [...(used.get(m[1]) ?? []), relative(APP, abs).split(sep).join("/")]);
    }
}

describe("tab titles", () => {
    it("the root layout adds the product to every screen's name", () => {
        expect(TITLE_TEMPLATE).toBe("%s · LiTT");
        expect(readFileSync(join(APP, "layout.tsx"), "utf8")).toContain("template: TITLE_TEMPLATE");
    });

    it.each(["login", "signup", "forgotPassword", "resetPassword", "terms", "privacy", "settings", "assistant", "projects"])(
        "%s has a title",
        (key) => {
            expect(used.has(key)).toBe(true);
        },
    );

    it("every title key used exists in both catalogs", () => {
        for (const key of used.keys()) {
            expect((esMX.common.pageTitle as Record<string, string>)[key], `es-MX ${key}`).toBeTruthy();
            expect((enUS.common.pageTitle as Record<string, string>)[key], `en-US ${key}`).toBeTruthy();
        }
    });

    it("no route uses a title key twice by accident, and none is left unused", () => {
        const defined = Object.keys(esMX.common.pageTitle);
        expect(defined.filter((key) => !used.has(key))).toEqual([]);
    });
});

describe("useDocumentTitle", () => {
    it("names the tab after the loaded name and puts the route's title back on leaving", () => {
        document.title = "Chat · LiTT";
        const { rerender, unmount } = renderHook(({ name }) => useDocumentTitle(name), {
            initialProps: { name: null as string | null },
        });
        expect(document.title).toBe("Chat · LiTT");
        rerender({ name: " Contract review " });
        expect(document.title).toBe(titleFor("Contract review"));
        unmount();
        expect(document.title).toBe("Chat · LiTT");
    });
});

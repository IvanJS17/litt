import { afterEach, describe, expect, it, vi } from "vitest";
import {
    THEME_BOOT_SCRIPT,
    THEME_COLOR_DARK,
    THEME_COLOR_LIGHT,
    THEME_STORAGE_KEY,
    applyDarkMode,
} from "./theme";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

const themeColor = () =>
    Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map(
        (meta) => meta.content,
    );

describe("applyDarkMode", () => {
    it("enables dark colors on the document root", () => {
        applyDarkMode(true);
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("returns the document root to light mode", () => {
        document.documentElement.classList.add("dark");
        applyDarkMode(false);
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("colours the browser bar with the page: tinta on dark, papel on light, one tag", () => {
        applyDarkMode(true);
        expect(themeColor()).toEqual([THEME_COLOR_DARK]);
        applyDarkMode(false);
        expect(themeColor()).toEqual([THEME_COLOR_LIGHT]);
        expect(THEME_COLOR_LIGHT).toBe("#ECECE6");
        expect(THEME_COLOR_DARK).toBe("#151A26");
    });

    it("does nothing when rendered without a document", () => {
        vi.stubGlobal("document", undefined);
        expect(() => applyDarkMode(true)).not.toThrow();
    });

    it("remembers the theme for the next first paint", () => {
        applyDarkMode(true);
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
        applyDarkMode(false);
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    });
});

describe("THEME_BOOT_SCRIPT", () => {
    const boot = () => new Function(THEME_BOOT_SCRIPT)();

    it("paints dark before anything else runs when the last visit was dark", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "dark");
        boot();
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("sets the browser bar colour before first paint, tinta only if the last visit was dark", () => {
        boot();
        expect(themeColor()).toEqual([THEME_COLOR_LIGHT]);
        document.head.querySelector('meta[name="theme-color"]')!.remove();
        localStorage.setItem(THEME_STORAGE_KEY, "dark");
        boot();
        expect(themeColor()).toEqual([THEME_COLOR_DARK]);
    });

    it("leaves the page light otherwise, even with storage blocked", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "light");
        boot();
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(boot).not.toThrow();
        expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
});

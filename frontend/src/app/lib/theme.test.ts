import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, applyDarkMode } from "./theme";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
});

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

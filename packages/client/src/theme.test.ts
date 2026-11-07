import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDarkMode } from "./theme";

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
});

describe("applyDarkMode", () => {
    it("turns the dark theme on and off on the document root", () => {
        applyDarkMode(true);
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");

        applyDarkMode(false);
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("does nothing without a document", () => {
        vi.stubGlobal("document", undefined);
        expect(() => applyDarkMode(true)).not.toThrow();
    });
});

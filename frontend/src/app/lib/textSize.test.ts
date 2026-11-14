import { afterEach, describe, expect, it, vi } from "vitest";
import {
    applyTextSize,
    isTextSize,
    TEXT_SIZE_BOOT_SCRIPT,
    TEXT_SIZE_STORAGE_KEY,
} from "./textSize";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-text-size");
    window.localStorage.clear();
});

describe("applyTextSize", () => {
    it("sets data-text-size on <html> for large and xlarge and remembers it", () => {
        applyTextSize("large");
        expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
        expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("large");

        applyTextSize("xlarge");
        expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
        expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("xlarge");
    });

    it("removes the attribute for normal, so the page is as it was before", () => {
        applyTextSize("xlarge");
        applyTextSize("normal");
        expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
        expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("normal");
    });

    it("does nothing without a document", () => {
        vi.stubGlobal("document", undefined);
        expect(() => applyTextSize("large")).not.toThrow();
    });

    it("still applies when storage is blocked", () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(() => applyTextSize("large")).not.toThrow();
        expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
    });
});

describe("isTextSize", () => {
    it("accepts only the three sizes", () => {
        expect(["normal", "large", "xlarge"].every(isTextSize)).toBe(true);
        expect(isTextSize("huge")).toBe(false);
        expect(isTextSize(undefined)).toBe(false);
    });
});

describe("TEXT_SIZE_BOOT_SCRIPT", () => {
    const run = () => new Function(TEXT_SIZE_BOOT_SCRIPT)();

    it("applies the remembered size before the first paint", () => {
        window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "xlarge");
        run();
        expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
    });

    it("ignores normal, an unknown value and no value", () => {
        for (const value of ["normal", "<script>", null]) {
            document.documentElement.removeAttribute("data-text-size");
            window.localStorage.clear();
            if (value) window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, value);
            run();
            expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
        }
    });

    it("does not throw when storage is blocked", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(run).not.toThrow();
    });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    THEME_BOOT_SCRIPT,
    THEME_COLOR_DARK,
    THEME_COLOR_LIGHT,
    THEME_STORAGE_KEY,
    applyTheme,
} from "./theme";

afterEach(() => {
    applyTheme("light");
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
const isDark = () => document.documentElement.classList.contains("dark");

/** A device whose colour scheme a test can flip, like one that goes dark at dusk. */
function stubDevice(initialDark: boolean) {
    const listeners = new Set<(event: { matches: boolean }) => void>();
    let dark = initialDark;
    vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
            media: query,
            get matches() {
                return dark && query === "(prefers-color-scheme: dark)";
            },
            addEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
                listeners.add(fn),
            removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
                listeners.delete(fn),
        })),
    );
    return {
        listeners,
        set(next: boolean) {
            dark = next;
            for (const fn of [...listeners]) fn({ matches: next });
        },
    };
}

describe("applyTheme", () => {
    it("paints dark and light on the document root", () => {
        expect(applyTheme("dark")).toBe("dark");
        expect(isDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
        expect(applyTheme("light")).toBe("light");
        expect(isDark()).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("colours the browser bar with the page: tinta on dark, papel on light, one tag", () => {
        applyTheme("dark");
        expect(themeColor()).toEqual([THEME_COLOR_DARK]);
        applyTheme("light");
        expect(themeColor()).toEqual([THEME_COLOR_LIGHT]);
        expect(THEME_COLOR_LIGHT).toBe("#ECECE6");
        expect(THEME_COLOR_DARK).toBe("#151A26");
    });

    it("does nothing when rendered without a document", () => {
        vi.stubGlobal("document", undefined);
        expect(applyTheme("dark")).toBeNull();
    });

    it("remembers the preference, not its result", () => {
        stubDevice(true);
        applyTheme("system");
        expect(isDark()).toBe(true);
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
        applyTheme("dark");
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
        applyTheme("light");
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    });

    it("still paints when storage is blocked", () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(() => applyTheme("dark")).not.toThrow();
        expect(isDark()).toBe(true);
    });
});

describe("Automático", () => {
    it("takes what the device asks for now", () => {
        stubDevice(true);
        expect(applyTheme("system")).toBe("dark");
        expect(isDark()).toBe(true);
        expect(themeColor()).toEqual([THEME_COLOR_DARK]);
    });

    it("follows the device live, bar included, while it is the preference", () => {
        const device = stubDevice(false);
        applyTheme("system");
        expect(isDark()).toBe(false);

        device.set(true);
        expect(isDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
        expect(themeColor()).toEqual([THEME_COLOR_DARK]);

        device.set(false);
        expect(isDark()).toBe(false);
        expect(themeColor()).toEqual([THEME_COLOR_LIGHT]);
    });

    it("keeps one listener however many times it is applied", () => {
        const device = stubDevice(false);
        applyTheme("system");
        applyTheme("system");
        applyTheme("system");
        expect(device.listeners.size).toBe(1);
    });

    it("stops following the device once another preference is chosen", () => {
        const device = stubDevice(false);
        applyTheme("system");
        applyTheme("light");
        expect(device.listeners.size).toBe(0);
        device.set(true);
        expect(isDark()).toBe(false);

        applyTheme("dark");
        device.set(false);
        expect(isDark()).toBe(true);
    });
});

describe("THEME_BOOT_SCRIPT", () => {
    const boot = () => new Function(THEME_BOOT_SCRIPT)();

    it("paints dark before anything else runs when the last visit was dark", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "dark");
        boot();
        expect(isDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("resolves system with the device before the first paint", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "system");
        stubDevice(true);
        boot();
        expect(isDark()).toBe(true);
        expect(themeColor()).toEqual([THEME_COLOR_DARK]);

        document.documentElement.classList.remove("dark");
        document.head.querySelector('meta[name="theme-color"]')!.remove();
        stubDevice(false);
        boot();
        expect(isDark()).toBe(false);
        expect(themeColor()).toEqual([THEME_COLOR_LIGHT]);
    });

    it("does not break where the browser has no matchMedia", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "system");
        vi.stubGlobal("matchMedia", undefined);
        expect(boot).not.toThrow();
        expect(isDark()).toBe(false);
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
        expect(isDark()).toBe(false);
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(boot).not.toThrow();
        expect(isDark()).toBe(false);
    });

    it("ignores a stored value it does not know", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "<script>");
        boot();
        expect(isDark()).toBe(false);
    });
});

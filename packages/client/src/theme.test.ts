import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_THEME,
    THEMES,
    applyDarkMode,
    isTheme,
    resolveTheme,
    systemPrefersDark,
    watchSystemTheme,
} from "./theme";

/** A matchMedia whose answer a test can flip, like a device changing at dusk. */
function stubSystemScheme(initialDark: boolean) {
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

describe("theme preference", () => {
    it("has the three values and starts new accounts on system", () => {
        expect([...THEMES]).toEqual(["light", "dark", "system"]);
        expect(DEFAULT_THEME).toBe("system");
        expect(isTheme("system")).toBe(true);
        expect(isTheme("sepia")).toBe(false);
        expect(isTheme(true)).toBe(false);
        expect(isTheme(undefined)).toBe(false);
    });

    it("resolves light and dark to themselves and system to the device", () => {
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
    });

    it("asks the device when it is not told", () => {
        stubSystemScheme(true);
        expect(systemPrefersDark()).toBe(true);
        expect(resolveTheme("system")).toBe("dark");
    });

    it("reads light where the browser cannot say", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(systemPrefersDark()).toBe(false);
        expect(resolveTheme("system")).toBe("light");
        expect(() => watchSystemTheme(() => {})()).not.toThrow();
    });
});

describe("watchSystemTheme", () => {
    it("reports each change of the device and stops when told", () => {
        const device = stubSystemScheme(false);
        const seen: boolean[] = [];
        const stop = watchSystemTheme((dark) => seen.push(dark));

        device.set(true);
        device.set(false);
        expect(seen).toEqual([true, false]);

        stop();
        expect(device.listeners.size).toBe(0);
        device.set(true);
        expect(seen).toEqual([true, false]);
    });
});

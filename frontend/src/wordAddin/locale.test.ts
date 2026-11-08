/**
 * Which language the Word task pane starts in, and how Word's display
 * language maps onto LiTT's two (plan i18n §2.4).
 */
import { describe, expect, it, vi } from "vitest";
import {
    LOCALE_STORAGE_KEY,
    initialLocale,
    localeFromDisplayLanguage,
    readStoredLocale,
    storeLocale,
    wordDisplayLanguage,
} from "../../../word-addin/src/taskpane/i18n/locale";

const memory = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
    };
};

describe("Word displayLanguage", () => {
    it.each([
        ["es-MX", "es-MX"],
        ["es-ES", "es-MX"],
        ["es-419", "es-MX"],
        ["es", "es-MX"],
        ["en-US", "en-US"],
        ["en-GB", "en-US"],
        ["EN-au", "en-US"],
        // No match falls to the default, es-MX.
        ["fr-FR", "es-MX"],
        ["ja-JP", "es-MX"],
        ["", "es-MX"],
        [undefined, "es-MX"],
        [null, "es-MX"],
    ])("%s gives %s", (displayLanguage, expected) => {
        expect(localeFromDisplayLanguage(displayLanguage)).toBe(expected);
    });
});

describe("the language the pane starts in", () => {
    it("prefers the language chosen on this device", () => {
        const storage = memory({ [LOCALE_STORAGE_KEY]: "en-US" });
        expect(initialLocale(storage, "es-MX")).toBe("en-US");
    });

    it("else follows Word's display language", () => {
        expect(initialLocale(memory(), "en-GB")).toBe("en-US");
        expect(initialLocale(memory(), "es-ES")).toBe("es-MX");
    });

    it("else is es-MX, including where Office is unavailable", () => {
        expect(initialLocale(memory(), undefined)).toBe("es-MX");
        expect(initialLocale(null, undefined)).toBe("es-MX");
    });

    it("ignores a saved value that is not a supported language", () => {
        const storage = memory({ [LOCALE_STORAGE_KEY]: "fr-FR" });
        expect(readStoredLocale(storage)).toBeNull();
        expect(initialLocale(storage, "en-US")).toBe("en-US");
    });

    it("remembers a choice for the next open", () => {
        const storage = memory();
        storeLocale("en-US", storage);
        expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
        expect(readStoredLocale(storage)).toBe("en-US");
    });

    it("keeps working when the host refuses storage", () => {
        const refusing = {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        };
        expect(() => storeLocale("en-US", refusing)).not.toThrow();
        expect(readStoredLocale(refusing)).toBeNull();
    });

    it("uses the real storage and Office.context.displayLanguage by default", () => {
        window.localStorage.clear();
        expect(wordDisplayLanguage()).toBeUndefined();
        vi.stubGlobal("Office", { context: { displayLanguage: "en-GB" } });
        try {
            expect(wordDisplayLanguage()).toBe("en-GB");
            expect(initialLocale()).toBe("en-US");
            storeLocale("es-MX");
            expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es-MX");
            expect(initialLocale()).toBe("es-MX");
        } finally {
            vi.unstubAllGlobals();
            window.localStorage.clear();
        }
    });
});

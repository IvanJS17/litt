import { describe, expect, it } from "vitest";
import enUS from "../messages/en-US.json";
import esMX from "../messages/es-MX.json";
import { DEFAULT_LOCALE, isLocale, loadMessages, negotiateLocale } from "./index";

describe("negotiateLocale", () => {
    it("falls back to es-MX when nothing supported is requested", () => {
        expect(DEFAULT_LOCALE).toBe("es-MX");
        expect(negotiateLocale([])).toBe("es-MX");
        expect(negotiateLocale([null, undefined, "", "*", "fr-FR", "de"])).toBe("es-MX");
    });

    it("takes the first supported tag, exactly or by language", () => {
        expect(negotiateLocale(["en-us"])).toBe("en-US");
        expect(negotiateLocale(["en-GB", "es-MX"])).toBe("en-US");
        expect(negotiateLocale(["fr", "es-419", "en"])).toBe("es-MX");
        expect(negotiateLocale(["es_ES"])).toBe("es-MX");
        expect(negotiateLocale([null, "en"])).toBe("en-US");
    });
});

describe("isLocale and loadMessages", () => {
    it("accepts only the supported tags", () => {
        expect(isLocale("es-MX")).toBe(true);
        expect(isLocale("en-US")).toBe(true);
        expect(isLocale("es")).toBe(false);
        expect(isLocale(null)).toBe(false);
    });

    it("loads each locale's own catalog", async () => {
        expect(await loadMessages("en-US")).toEqual(enUS);
        expect(await loadMessages("es-MX")).toEqual(esMX);
    });
});

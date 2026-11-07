import { describe, expect, it } from "vitest";
import enUS from "../messages/en-US.json";
import esMX from "../messages/es-MX.json";
import {
    DEFAULT_LOCALE,
    isLocale,
    loadMessages,
    negotiateLocale,
    parseAcceptLanguage,
    type Locale,
} from "./index";

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

    it("takes an array of bare tags; a header goes through parseAcceptLanguage", () => {
        // @ts-expect-error a bare string would be read character by character
        expect(() => negotiateLocale("en-US")).toThrow(TypeError);
        // Read in order, "es" beats "en" here; its quality says otherwise.
        expect(negotiateLocale(parseAcceptLanguage("es;q=0.3, en;q=0.9"))).toBe("en-US");
        expect(negotiateLocale(parseAcceptLanguage("en;q=0, es-ES"))).toBe("es-MX");
    });
});

describe("parseAcceptLanguage", () => {
    it("orders tags by quality and keeps ties in header order", () => {
        expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5")).toEqual([
            "fr-CH",
            "fr",
            "en",
            "de",
            "*",
        ]);
        expect(parseAcceptLanguage("es;q=0.3,en;q=0.9")).toEqual(["en", "es"]);
        expect(parseAcceptLanguage("en-GB;q=0.8, es-MX;q=0.8, de")).toEqual(["de", "en-GB", "es-MX"]);
        expect(parseAcceptLanguage(" en ; Q=1.000 ")).toEqual(["en"]);
    });

    it("drops q=0, malformed qualities and empty entries", () => {
        expect(parseAcceptLanguage("en;q=0, es")).toEqual(["es"]);
        expect(parseAcceptLanguage("en;q=2, fr;q=abc, de;q=, es;q=0.5")).toEqual(["es"]);
        expect(parseAcceptLanguage(",, ;q=1,")).toEqual([]);
        expect(parseAcceptLanguage("")).toEqual([]);
        expect(parseAcceptLanguage(null)).toEqual([]);
        expect(parseAcceptLanguage(undefined)).toEqual([]);
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

    it("loads es-MX for an unsupported value instead of throwing", async () => {
        expect(await loadMessages("fr-FR" as Locale)).toEqual(esMX);
        expect(await loadMessages(undefined as unknown as Locale)).toEqual(esMX);
    });
});

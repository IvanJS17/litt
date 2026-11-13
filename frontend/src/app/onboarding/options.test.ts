import { describe, expect, it, vi } from "vitest";
import {
    COUNTRY_OPTIONS,
    PRACTICE_AREA_LABEL_KEYS,
    PRACTICE_AREA_OPTIONS,
    PROFESSIONAL_TITLE_LABEL_KEYS,
    PROFESSIONAL_TITLE_OPTIONS,
    countryLabel,
} from "./options";
import esMX from "../../../../packages/i18n/messages/es-MX.json";

function lookup(key: string): unknown {
    return key
        .split(".")
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], esMX);
}

describe("onboarding option labels", () => {
    it("names every country in the interface language and keeps the stored value", () => {
        expect(countryLabel("Mexico", "es-MX")).toBe("México");
        expect(countryLabel("United States", "es-MX")).toBe("Estados Unidos");
        expect(countryLabel("Mexico", "en-US")).toBe("Mexico");
        for (const country of COUNTRY_OPTIONS) {
            expect(countryLabel(country, "es-MX")).not.toBe("");
        }
    });

    it("shows a country that is not in the list as saved", () => {
        expect(countryLabel("Atlantis", "es-MX")).toBe("Atlantis");
    });

    it("builds one name formatter per language, however many rows ask", () => {
        const RealDisplayNames = Intl.DisplayNames;
        const created: string[] = [];
        const spy = vi.spyOn(Intl, "DisplayNames").mockImplementation(function (
            this: unknown,
            locales: string | string[] | undefined,
            options: Intl.DisplayNamesOptions,
        ) {
            created.push(String(locales));
            return new RealDisplayNames(locales, options);
        } as unknown as typeof Intl.DisplayNames);
        try {
            for (const country of ["Mexico", "Spain", "France", "Mexico"]) countryLabel(country, "de-DE");
            countryLabel("Mexico", "it-IT");
            expect(created).toEqual(["de-DE", "it-IT"]);
        } finally {
            spy.mockRestore();
        }
    });

    it("has a Spanish label for every practice area and title", () => {
        for (const area of PRACTICE_AREA_OPTIONS.filter((a) => a !== "Other")) {
            const key = PRACTICE_AREA_LABEL_KEYS[area as keyof typeof PRACTICE_AREA_LABEL_KEYS];
            expect(typeof lookup(key)).toBe("string");
        }
        for (const title of PROFESSIONAL_TITLE_OPTIONS) {
            expect(typeof lookup(PROFESSIONAL_TITLE_LABEL_KEYS[title])).toBe("string");
        }
    });
});

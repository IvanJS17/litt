import { afterEach, describe, expect, it } from "vitest";
import { citationCheckApiKey, citationCheckEnabled } from "./chatFeatureGates";

afterEach(() => {
    delete process.env.LITT_CITATION_CHECK;
    delete process.env.TYPESAFE_API_KEY;
});

describe("citationCheckEnabled", () => {
    it("is off by default and for anything but `enabled`", () => {
        expect(citationCheckEnabled()).toBe(false);
        for (const value of ["", "disabled", "true", "1", "ENABLED", "on"]) {
            process.env.LITT_CITATION_CHECK = value;
            expect(citationCheckEnabled()).toBe(false);
        }
    });

    it("is on only for `enabled`", () => {
        process.env.LITT_CITATION_CHECK = "enabled";
        expect(citationCheckEnabled()).toBe(true);
        process.env.LITT_CITATION_CHECK = " enabled ";
        expect(citationCheckEnabled()).toBe(true);
    });
});

describe("citationCheckApiKey", () => {
    it("is the platform key, and only while the server switch is on", () => {
        process.env.TYPESAFE_API_KEY = " key-1 ";
        expect(citationCheckApiKey()).toBeNull();
        process.env.LITT_CITATION_CHECK = "enabled";
        expect(citationCheckApiKey()).toBe("key-1");
        process.env.TYPESAFE_API_KEY = "  ";
        expect(citationCheckApiKey()).toBeNull();
        delete process.env.TYPESAFE_API_KEY;
        expect(citationCheckApiKey()).toBeNull();
    });
});

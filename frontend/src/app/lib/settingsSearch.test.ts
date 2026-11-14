import { describe, expect, it } from "vitest";
import {
    SETTINGS_SEARCH_ENTRIES,
    localizedSettingsEntries,
    searchSettings,
    type SettingsSearchResult,
} from "./settingsSearch";
import type { Translate } from "@/i18n/Translate";

function ids(results: SettingsSearchResult[]) {
    return results.map((result) => result.entry.id);
}

function kinds(results: SettingsSearchResult[]) {
    return Object.fromEntries(
        results.map((result) => [result.entry.id, result.kind]),
    );
}

describe("searchSettings", () => {
    it("gives nothing for an empty or meaningless query", () => {
        expect(searchSettings("")).toEqual([]);
        expect(searchSettings("   ")).toEqual([]);
        expect(searchSettings("the settings for my")).toEqual([]);
    });

    it("matches a section by its exact name, ignoring case and punctuation", () => {
        const results = searchSettings("My AI keys!");
        expect(ids(results)[0]).toBe("byok");
        expect(results[0].kind).toBe("exact");
    });

    it("counts a whole phrase inside a name as exact, not a fragment of a word", () => {
        expect(kinds(searchSettings("dark"))["appearance-theme"]).toBe(
            "exact",
        );
        // "ark" is inside "dark" but is not a word of it.
        expect(kinds(searchSettings("ark"))["appearance-theme"]).toBeUndefined();
    });

    it("finds My AI keys from the words people use for it", () => {
        for (const query of ["api key", "anthropic", "openai key", "where do I add my claude key", "BYOK"]) {
            expect(ids(searchSettings(query)), query).toContain("byok");
        }
        expect(ids(searchSettings("api key"))[0]).toBe("byok");
    });

    it("finds Security from 2FA and authenticator jargon", () => {
        for (const query of ["2fa", "two factor", "authenticator app", "totp"]) {
            expect(ids(searchSettings(query))[0], query).toBe("security-mfa");
        }
    });

    it("ranks an exact title hit above a keyword hit on another entry", () => {
        // "Memory" is a title; it is also a keyword of the memory-model entry.
        const results = searchSettings("memory");
        expect(results[0].entry.id).toBe("memory");
        expect(results[0].kind).toBe("exact");
        expect(ids(results)).toContain("models-memory");
    });

    it("puts exact matches before related ones whatever their score", () => {
        const results = searchSettings("delete");
        const firstRelated = results.findIndex((r) => r.kind === "related");
        const lastExact = results.map((r) => r.kind).lastIndexOf("exact");
        expect(lastExact).toBeGreaterThanOrEqual(0);
        if (firstRelated >= 0) expect(lastExact).toBeLessThan(firstRelated);
        expect(ids(results)).toEqual(
            expect.arrayContaining(["account-delete", "privacy-delete"]),
        );
    });

    it("survives a typo", () => {
        expect(ids(searchSettings("pasword"))).toContain("security-password");
        expect(ids(searchSettings("apearance"))).toContain("appearance-theme");
        expect(ids(searchSettings("conectors"))).toContain("connectors-installed");
        // The theme control (Light, Dark, Automatic) is the Appearance entry.
        expect(ids(searchSettings("theem"))).toContain("appearance-theme");
        expect(ids(searchSettings("themme"))).toContain("appearance-theme");
    });

    it("does not treat a known word as a typo of another", () => {
        expect(ids(searchSettings("model"))).not.toContain("appearance-theme");
    });

    it("orders exact keyword hits by how much of the keyword the query fills", () => {
        // "google" is all of a My AI keys keyword and part of
        // Security's "google authenticator".
        const results = ids(searchSettings("google"));
        expect(results.indexOf("byok")).toBeLessThan(results.indexOf("security-mfa"));
        expect(results.indexOf("connectors-discover")).toBeLessThan(results.indexOf("security-mfa"));
    });

    it("keeps a query with one unknown word", () => {
        expect(ids(searchSettings("gpt-4"))).toEqual(["byok"]);
        expect(ids(searchSettings("exporting"))).toContain("privacy-export");
    });

    it("folds plurals and British spelling into one word", () => {
        expect(ids(searchSettings("organisations"))[0]).toBe("organizations");
        expect(ids(searchSettings("connector"))).toContain("connectors-discover");
        expect(ids(searchSettings("invitations"))[0]).toBe("organizations-invitations");
    });

    it("matches a word typed only part way", () => {
        expect(ids(searchSettings("pass"))).toContain("security-password");
        expect(ids(searchSettings("expo"))).toContain("privacy-export");
    });

    it("does not return every entry for a vague multi-word query", () => {
        const results = searchSettings("google drive connector");
        expect(results[0].entry.id).toBe("connectors-discover");
        expect(results.length).toBeLessThan(SETTINGS_SEARCH_ENTRIES.length / 2);
    });

    it("searches only the entries it is given", () => {
        const subset = SETTINGS_SEARCH_ENTRIES.filter(
            (entry) => entry.tabId !== "privacy-data",
        );
        expect(ids(searchSettings("export", subset))).not.toContain(
            "privacy-export",
        );
    });

    it("has unique ids and a href under /settings for every entry", () => {
        const seen = new Set<string>();
        for (const entry of SETTINGS_SEARCH_ENTRIES) {
            expect(seen.has(entry.id), entry.id).toBe(false);
            seen.add(entry.id);
            expect(entry.href.startsWith("/settings")).toBe(true);
        }
    });

    describe("LiTT sections", () => {
        it("finds Formación, Subagentes, the source offer, data download and account deletion", () => {
            expect(ids(searchSettings("formación"))[0]).toBe("training");
            expect(ids(searchSettings("mentor"))).toEqual(expect.arrayContaining(["training", "training-pupils"]));
            expect(ids(searchSettings("subagentes"))[0]).toBe("models-subagents");
            expect(ids(searchSettings("código fuente"))[0]).toBe("account-source-code");
            expect(ids(searchSettings("agpl"))).toContain("account-source-code");
            expect(ids(searchSettings("descargar datos"))).toContain("privacy-export");
            expect(ids(searchSettings("borrar cuenta"))[0]).toBe("account-delete");
        });

        it("has no CourtListener and never names Mike", () => {
            expect(searchSettings("courtlistener")).toEqual([]);
            expect(ids(searchSettings("case law"))).not.toContain("connectors-discover");
            for (const entry of SETTINGS_SEARCH_ENTRIES) {
                const text = [entry.title, entry.description, ...entry.keywords].join(" ");
                expect(text, entry.id).not.toMatch(/\bmike\b|courtlistener/i);
            }
        });
    });
});

describe("settings search in the interface language", () => {
    async function translate(locale: "es-MX" | "en-US") {
        const { createTranslator } = await import("use-intl");
        const { loadMessages } = await import("@litt/i18n");
        return createTranslator({
            locale,
            messages: await loadMessages(locale),
        }) as unknown as Translate;
    }

    it("shows the labels of the active language", async () => {
        const entries = localizedSettingsEntries(await translate("es-MX"));
        const pupils = entries.find((entry) => entry.id === "training-pupils");
        expect(pupils?.title).toBe("Mis aprendices");
        expect(pupils?.source?.title).toBe("My mentees");
    });

    it("finds an entry by its English source text while the interface is in Spanish", async () => {
        const entries = localizedSettingsEntries(await translate("es-MX"));
        const ids = (query: string) => searchSettings(query, entries).map((result) => result.entry.id);
        expect(ids("pupilos")).toContain("training-pupils");
        expect(ids("mentees")).toContain("training-pupils");
    });

    it("finds a Spanish keyword while the interface is in English", async () => {
        const entries = localizedSettingsEntries(await translate("en-US"));
        const ids = searchSettings("pupilos", entries).map((result) => result.entry.id);
        expect(ids).toContain("training-pupils");
    });

    it("keeps the English index as the source", () => {
        expect(SETTINGS_SEARCH_ENTRIES.find((entry) => entry.id === "account-profile")?.title).toBe("Profile");
    });
});

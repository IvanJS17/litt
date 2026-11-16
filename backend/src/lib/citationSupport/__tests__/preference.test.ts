import { describe, expect, it } from "vitest";
import { citationCheckPermitted, citationCheckWanted, setCitationCheckWanted } from "../preference";

const dbWith = (result: { data?: unknown; error?: { code?: string } | null }) =>
    ({
        from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }) }) }),
            update: (patch: unknown) => ({
                eq: () => ({ select: async () => ({ data: result.data ?? null, error: result.error ?? null, patch }) }),
            }),
        }),
    }) as never;

describe("citationCheckWanted", () => {
    it("is on unless the person turned it off", async () => {
        expect(await citationCheckWanted(dbWith({ data: { citation_check: true } }), "u")).toBe(true);
        expect(await citationCheckWanted(dbWith({ data: { citation_check: false } }), "u")).toBe(false);
        expect(await citationCheckWanted(dbWith({ data: null }), "u")).toBe(true);
    });

    it("reads a database without the column as on, and any other failure as an error", async () => {
        expect(await citationCheckWanted(dbWith({ error: { code: "42703" } }), "u")).toBe(true);
        await expect(citationCheckWanted(dbWith({ error: { code: "XX000" } }), "u")).rejects.toBeTruthy();
    });
});

describe("setCitationCheckWanted", () => {
    it("says whether a profile was updated", async () => {
        expect(await setCitationCheckWanted(dbWith({ data: [{ user_id: "u" }] }), "u", false)).toBe(true);
        expect(await setCitationCheckWanted(dbWith({ data: [] }), "u", false)).toBe(false);
    });
});

describe("citationCheckPermitted", () => {
    const row = (citation_check: unknown, terms_accepted_version: unknown) => dbWith({ data: { citation_check, terms_accepted_version } });
    it("needs no opt-out and the current legal version", async () => {
        expect(await citationCheckPermitted(row(true, "v2"), "u", "v2")).toBe(true);
        expect(await citationCheckPermitted(row(false, "v2"), "u", "v2")).toBe(false);
        expect(await citationCheckPermitted(row(true, "v1"), "u", "v2")).toBe(false);
        expect(await citationCheckPermitted(row(true, null), "u", "v2")).toBe(false);
    });
    it("reads any doubt as no", async () => {
        expect(await citationCheckPermitted(dbWith({ data: null }), "u", "v2")).toBe(false);
        expect(await citationCheckPermitted(dbWith({ error: { code: "42703" } }), "u", "v2")).toBe(false);
        expect(await citationCheckPermitted(dbWith({ error: { code: "XX000" } }), "u", "v2")).toBe(false);
    });
});

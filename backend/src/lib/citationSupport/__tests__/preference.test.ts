import { describe, expect, it } from "vitest";
import { citationCheckWanted, setCitationCheckWanted } from "../preference";

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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCitationCheckSetting, updateCitationCheckSetting } from "./user.citationCheck";

let row: { citation_check: boolean } | null = { citation_check: true };
const db = {
    from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
        update: (patch: { citation_check: boolean }) => ({
            eq: () => ({
                select: async () => {
                    if (row) row = { citation_check: patch.citation_check };
                    return { data: row ? [{ user_id: "u" }] : [], error: null };
                },
            }),
        }),
    }),
} as never;

beforeEach(() => {
    row = { citation_check: true };
    process.env.LITT_CITATION_CHECK = "enabled";
    process.env.TYPESAFE_API_KEY = "platform-key-xyz";
});
afterEach(() => {
    delete process.env.LITT_CITATION_CHECK;
    delete process.env.TYPESAFE_API_KEY;
});

describe("the personal citation check setting", () => {
    it("is on by default and available when the deployment runs it", async () => {
        expect(await getCitationCheckSetting(db, "u")).toEqual({ ok: true, data: { available: true, enabled: true } });
    });

    it("is not available without the server switch or the platform key, and never returns the key", async () => {
        delete process.env.TYPESAFE_API_KEY;
        expect(await getCitationCheckSetting(db, "u")).toEqual({ ok: true, data: { available: false, enabled: true } });
        process.env.TYPESAFE_API_KEY = "platform-key-xyz";
        delete process.env.LITT_CITATION_CHECK;
        const result = await getCitationCheckSetting(db, "u");
        expect(result).toEqual({ ok: true, data: { available: false, enabled: true } });
        expect(JSON.stringify(result)).not.toContain("platform-key-xyz");
    });

    it("saves the opt-out and the opt-in", async () => {
        expect(await updateCitationCheckSetting(db, "u", false)).toMatchObject({ ok: true, data: { enabled: false } });
        expect(row).toEqual({ citation_check: false });
        expect(await updateCitationCheckSetting(db, "u", true)).toMatchObject({ ok: true, data: { enabled: true } });
    });

    it("refuses anything but a boolean, and a missing profile", async () => {
        expect(await updateCitationCheckSetting(db, "u", "no")).toMatchObject({ ok: false, kind: "validation" });
        row = null;
        expect(await updateCitationCheckSetting(db, "u", false)).toMatchObject({ ok: false, kind: "not_found" });
    });
});

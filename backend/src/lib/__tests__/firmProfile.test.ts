import { describe, expect, it } from "vitest";
import {
    FIRM_DESCRIPTION_MAX,
    FIRM_PROFILE_MAX_BYTES,
    FIRM_PROFILE_TOO_LARGE_CODE,
    MX_STATE_CODES,
    MX_STATE_NAMES,
    changedFirmProfileFields,
    firmProfileBytes,
    firmProfileFacts,
    normalizeFirmProfile,
    readStoredFirmProfile,
} from "../firmProfile";

const ok = (input: unknown) => {
    const r = normalizeFirmProfile(input);
    if (!r.ok) throw new Error(r.detail);
    return r.profile;
};

describe("firm profile", () => {
    it("has the 32 states of Mexico, each with a stable id and a name", () => {
        expect(new Set(MX_STATE_CODES).size).toBe(32);
        expect(MX_STATE_CODES.every((code) => MX_STATE_NAMES[code])).toBe(true);
    });

    it("keeps what is set, trims it and drops what is empty", () => {
        expect(
            ok({
                hq_state: "JAL",
                hq_city: "  Guadalajara ",
                other_states: ["CMX", "JAL", "CMX"],
                size: "6-20",
                practice_areas: ["Tax", " tax ", ""],
                client_type: "mixed",
                industries: [" Manufactura "],
                brief_language: "es-MX",
                description: "  Despacho familiar.\r\nSegunda línea. ",
            }),
        ).toEqual({
            hq_state: "JAL",
            hq_city: "Guadalajara",
            other_states: ["CMX"],
            size: "6-20",
            practice_areas: ["Tax"],
            client_type: "mixed",
            industries: ["Manufactura"],
            brief_language: "es-MX",
            description: "Despacho familiar.\nSegunda línea.",
        });
    });

    it("stores nothing for an empty profile, and every field is optional", () => {
        expect(ok({})).toBeNull();
        expect(ok({ hq_city: " ", practice_areas: [], description: "" })).toBeNull();
        expect(ok(null)).toBeNull();
        expect(ok({ size: "1" })).toEqual({ size: "1" });
    });

    it("refuses the whole profile on a bad value, never trimming it to fit", () => {
        for (const bad of [
            "text",
            [],
            { nope: 1 },
            { hq_state: "XXX" },
            { other_states: ["JAL", "XXX"] },
            { size: "7" },
            { client_type: "all" },
            { brief_language: "fr" },
            { hq_city: "x".repeat(81) },
            { practice_areas: Array.from({ length: 13 }, (_, i) => `a${i}`) },
            { industries: ["x".repeat(61)] },
            { description: "x".repeat(FIRM_DESCRIPTION_MAX + 1) },
            { description: 5 },
        ]) {
            expect(normalizeFirmProfile(bad).ok, JSON.stringify(bad)).toBe(false);
        }
        expect(ok({ description: "x".repeat(FIRM_DESCRIPTION_MAX) })?.description).toHaveLength(FIRM_DESCRIPTION_MAX);
    });

    it("limits the size in bytes the way the database measures it", () => {
        const wide = {
            hq_city: "ñ".repeat(80),
            practice_areas: Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(60, "漢")),
            industries: Array.from({ length: 8 }, (_, i) => `${i}`.padEnd(60, "漢")),
            description: "漢".repeat(1000),
        };
        const result = normalizeFirmProfile(wide);
        expect(result).toMatchObject({ ok: false, code: FIRM_PROFILE_TOO_LARGE_CODE });
        // jsonb text has a space after ":" and ",".
        expect(firmProfileBytes({ size: "1", hq_state: "JAL" })).toBe(Buffer.byteLength('{"size": "1", "hq_state": "JAL"}'));
        expect(firmProfileBytes({ description: "é".repeat(1000) })).toBeLessThan(FIRM_PROFILE_MAX_BYTES);
    });

    it("reads a stale stored value as no profile", () => {
        expect(readStoredFirmProfile({ hq_state: "ZZZ" })).toBeNull();
        expect(readStoredFirmProfile(undefined)).toBeNull();
        expect(readStoredFirmProfile({ size: "1" })).toEqual({ size: "1" });
    });

    it("names the fields that changed, never their values", () => {
        expect(changedFirmProfileFields(null, { size: "1", description: "secreto" })).toEqual(["size", "description"]);
        expect(changedFirmProfileFields({ size: "1", hq_city: "León" }, { size: "1", hq_city: "Puebla" })).toEqual(["hq_city"]);
        expect(changedFirmProfileFields({ size: "1" }, null)).toEqual(["size"]);
        expect(changedFirmProfileFields({ size: "1" }, { size: "1" })).toEqual([]);
    });

    it("tells the assistant only what is present", () => {
        expect(firmProfileFacts(null)).toEqual({});
        expect(firmProfileFacts({ hq_state: "NLE", hq_city: "Monterrey", other_states: ["MEX"], client_type: "companies" })).toEqual({
            headquarters: "Monterrey, Nuevo León",
            also_present_in: ["Estado de México"],
            clients: "empresas",
        });
    });
});

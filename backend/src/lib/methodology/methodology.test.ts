import { describe, expect, it } from "vitest";
import {
    MethodologyError,
    add,
    daysBetween,
    exactText,
    formatDecimal,
    fromInt,
    mul,
    parseDecimal,
    powInt,
    ratio,
    roundTo,
} from "./decimal";
import { MAX_COMPOUND_PERIODS, calculate, type MethodologyResult } from "./calculators";
import { readAnnexLocale } from "./locale";
import { methodologyText } from "./messages";
import { annexDisclaimer, appearsInMessage, buildAnnex, describeSource, verifyBasis, type InputSource } from "./annex";

const dec = (text: string) => parseDecimal(text, "x");
const code = (run: () => unknown) => {
    try {
        run();
    } catch (error) {
        return error instanceof MethodologyError ? error.code : "other";
    }
    return "none";
};
const resultOf = (r: MethodologyResult) => [r.result.value, ...r.others.map((o) => o.value)];

describe("decimal arithmetic", () => {
    it("is exact where floats are not", () => {
        expect(exactText(add(dec("0.1"), dec("0.2")))).toBe("0.3");
        expect(exactText(mul(dec("1.1"), dec("1.1")))).toBe("1.21");
        expect(exactText(powInt(dec("1.01"), 12))).toBe("1.126825030131969720661201");
    });

    it("rounds half away from zero, on both signs", () => {
        expect(formatDecimal(dec("2.345"), 2)).toBe("2.35");
        expect(formatDecimal(dec("2.344999"), 2)).toBe("2.34");
        expect(formatDecimal(dec("-2.345"), 2)).toBe("-2.35");
        expect(formatDecimal(dec("0.005"), 2)).toBe("0.01");
        expect(formatDecimal(dec("-0.004"), 2)).toBe("0.00");
        expect(formatDecimal(roundTo(dec("9.995"), 2), 2)).toBe("10.00");
    });

    it("divides with explicit rounding and refuses zero", () => {
        expect(formatDecimal(ratio(fromInt(1), fromInt(3), 6), 6)).toBe("0.333333");
        expect(formatDecimal(ratio(fromInt(2), fromInt(3), 6), 6)).toBe("0.666667");
        expect(formatDecimal(ratio(dec("-1"), fromInt(3), 2), 2)).toBe("-0.33");
        expect(code(() => ratio(fromInt(1), fromInt(0), 2))).toBe("division_by_zero");
    });

    it("handles zero and very large values", () => {
        expect(formatDecimal(dec("0"), 2)).toBe("0.00");
        expect(exactText(powInt(dec("0"), 0))).toBe("1");
        const big = "999999999999999999999999999999.99";
        expect(formatDecimal(add(dec(big), dec("0.01")), 2)).toBe("1000000000000000000000000000000.00");
    });

    it("accepts only plain decimals", () => {
        for (const bad of ["1,000", "1e3", "1.", ".5", "abc", "", "1 000", "$5", "NaN", "Infinity", "0x10", "1.1234567890123"]) {
            expect(code(() => parseDecimal(bad, "x"))).toBe("invalid_number");
        }
        expect(code(() => parseDecimal(null, "x"))).toBe("invalid_number");
        expect(code(() => parseDecimal(1e21, "x"))).toBe("unsafe_number");
        expect(code(() => parseDecimal(0.1, "x"))).toBe("unsafe_number");
        expect(code(() => parseDecimal(9007199254740993, "x"))).toBe("unsafe_number");
        expect(exactText(parseDecimal(12, "x"))).toBe("12");
        expect(exactText(parseDecimal("9007199254740993", "x"))).toBe("9007199254740993");
        expect(exactText(dec(" 007.500 "))).toBe("7.5");
    });

    it("counts calendar days in UTC and rejects bad dates", () => {
        expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
        expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
        expect(daysBetween("2025-02-28", "2025-03-01")).toBe(1);
        expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
        expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
        expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
        expect(daysBetween("1900-01-01", "2000-01-01")).toBe(36524);
        expect(code(() => daysBetween("2026-02-30", "2026-03-01"))).toBe("invalid_date");
        expect(code(() => daysBetween("2026-1-1", "2026-03-01"))).toBe("invalid_date");
        expect(code(() => daysBetween("2026-03-02", "2026-03-01"))).toBe("invalid_date_range");
    });
});

describe("calculators", () => {
    it("simple interest by periods", () => {
        const r = calculate("simple_interest", { principal: "10000.00", rate_percent: "1.5", periods: "12" });
        expect(resultOf(r)).toEqual(["1800.00", "11800.00"]);
        expect(r.steps.map((s) => s.value)).toEqual(["0.015", "1800", "1800.00", "11800.00"]);
    });

    it("simple interest by dates rounds once, at the end", () => {
        // 12 345.67 × 0.0825 × 47 ÷ 360
        const r = calculate("simple_interest", {
            principal: "12345.67",
            rate_percent: "8.25",
            start_date: "2026-01-10",
            end_date: "2026-02-26",
            day_basis: "360",
        });
        expect(r.steps[0]!.value).toBe("47");
        expect(resultOf(r)).toEqual(["132.97", "12478.64"]);
        const leap = calculate("simple_interest", {
            principal: "1000", rate_percent: "10", start_date: "2024-01-01", end_date: "2025-01-01", day_basis: "366",
        });
        expect(resultOf(leap)).toEqual(["100.00", "1100.00"]);
    });

    it("simple interest edge cases: zeros, same day, mixed modes", () => {
        expect(resultOf(calculate("simple_interest", { principal: "0", rate_percent: "5", periods: "3" }))).toEqual(["0.00", "0.00"]);
        expect(resultOf(calculate("simple_interest", { principal: "100", rate_percent: "0", periods: "3" }))).toEqual(["0.00", "100.00"]);
        expect(
            resultOf(calculate("simple_interest", { principal: "100", rate_percent: "5", start_date: "2026-05-01", end_date: "2026-05-01", day_basis: "365" })),
        ).toEqual(["0.00", "100.00"]);
        expect(code(() => calculate("simple_interest", { principal: "1", rate_percent: "1", periods: "1", start_date: "2026-01-01" }))).toBe("conflicting_inputs");
        expect(code(() => calculate("simple_interest", { principal: "1", rate_percent: "1", start_date: "2026-01-01", end_date: "2026-02-01", day_basis: "350" }))).toBe("invalid_day_basis");
        expect(code(() => calculate("simple_interest", { principal: "1", rate_percent: "1", start_date: "2026-01-01", end_date: "2026-02-01", day_basis: "360.5" }))).toBe("invalid_day_basis");
    });

    it("compound interest is exact and shows the factor to 10 decimals", () => {
        const r = calculate("compound_interest", { principal: "10000", rate_percent: "1", periods: "12" });
        expect(r.steps[2]!.value).toBe("1.1268250301");
        expect(resultOf(r)).toEqual(["11268.25", "1268.25"]);
        expect(resultOf(calculate("compound_interest", { principal: "5000.50", rate_percent: "0", periods: "10" }))).toEqual(["5000.50", "0.00"]);
        expect(resultOf(calculate("compound_interest", { principal: "5000.50", rate_percent: "9", periods: "0" }))).toEqual(["5000.50", "0.00"]);
    });

    it("compound interest with a large capital and many periods stays exact", () => {
        const big = calculate("compound_interest", { principal: "999999999999999999999999999999.99", rate_percent: "0", periods: "600" });
        expect(big.result.value).toBe("999999999999999999999999999999.99");
        const long = calculate("compound_interest", { principal: "1", rate_percent: "100", periods: "100" });
        expect(long.result.value).toBe("1267650600228229401496703205376.00");
        expect(code(() => calculate("compound_interest", { principal: "1", rate_percent: "1", periods: String(MAX_COMPOUND_PERIODS + 1) }))).toBe("invalid_periods");
        expect(code(() => calculate("compound_interest", { principal: "1", rate_percent: "1", periods: "1.5" }))).toBe("invalid_periods");
        expect(code(() => calculate("compound_interest", { principal: "1", rate_percent: "1", periods: "-1" }))).toBe("invalid_periods");
    });

    it("index update divides once", () => {
        const r = calculate("index_update", { amount: "1000.00", initial_index: "100", final_index: "133.333" });
        expect(r.steps[0]!.value).toBe("1.3333300000");
        expect(resultOf(r)).toEqual(["1333.33", "1.3333300000", "333.33"]);
        // The unrounded quotient decides the cent: 100.01 × 7 ÷ 3 = 233.356666…
        expect(calculate("index_update", { amount: "100.01", initial_index: "3", final_index: "7" }).result.value).toBe("233.36");
        expect(calculate("index_update", { amount: "0", initial_index: "3", final_index: "7" }).result.value).toBe("0.00");
        expect(calculate("index_update", { amount: "100", initial_index: "200", final_index: "100" }).others[1]!.value).toBe("-50.00");
        expect(code(() => calculate("index_update", { amount: "1", initial_index: "0", final_index: "7" }))).toBe("zero_value");
        expect(code(() => calculate("index_update", { amount: "1", initial_index: "-3", final_index: "7" }))).toBe("negative_value");
    });

    it("proportion covers a guarantee, above and below 100 %", () => {
        expect(calculate("proportion", { numerator: "750000", denominator: "1000000" }).result.value).toBe("75.00 %");
        expect(calculate("proportion", { numerator: "1", denominator: "3" }).result.value).toBe("33.33 %");
        expect(calculate("proportion", { numerator: "2", denominator: "3" }).others[0]!.value).toBe("0.666667");
        expect(calculate("proportion", { numerator: "150", denominator: "100" }).result.value).toBe("150.00 %");
        expect(calculate("proportion", { numerator: "0", denominator: "5" }).result.value).toBe("0.00 %");
        expect(code(() => calculate("proportion", { numerator: "1", denominator: "0" }))).toBe("zero_value");
    });

    it("refuses missing, unknown and badly formed inputs", () => {
        expect(code(() => calculate("proportion", { numerator: "1" }))).toBe("missing_input");
        expect(code(() => calculate("proportion", { numerator: "1", denominator: "2", extra: "3" }))).toBe("unknown_input");
        expect(code(() => calculate("index_update", { amount: "10.001", initial_index: "1", final_index: "1" }))).toBe("too_many_decimals");
        expect(code(() => calculate("index_update", { amount: "-1", initial_index: "1", final_index: "1" }))).toBe("negative_value");
        expect(calculate("index_update", { amount: "10.100", initial_index: "1", final_index: "1" }).result.value).toBe("10.10");
        expect(code(() => calculate("simple_interest", { principal: "1,000", rate_percent: "1", periods: "1" }))).toBe("invalid_number");
    });
});

describe("annex", () => {
    const result = calculate("index_update", { amount: "1000", initial_index: "100", final_index: "110" });
    const verified: InputSource = { status: "document_verified", filename: "contrato.docx", excerpt: "índice inicial de 100 puntos" };

    it("lists inputs with their source, the formula, the steps, the rounding and the result", () => {
        const annex = buildAnnex(result, {
            sources: { amount: { status: "person" }, initial_index: verified },
            generatedAt: new Date("2026-11-08T12:00:00Z"),
            generatedFor: "ana@example.com",
        });
        const headings = annex.sections.map((s) => s.heading);
        expect(headings).toEqual(["Datos de origen", "Fórmula", "Pasos", "Regla de redondeo", "Resultado", "Generación"]);
        const inputs = annex.sections[0]!.table!;
        expect(inputs.rows).toEqual([
            ["Monto a actualizar", "1000", "Dato dado por la persona"],
            ["Índice inicial", "100", "«contrato.docx»: «índice inicial de 100 puntos» (cita verificada)"],
            ["Índice final", "110", "Sin fuente"],
        ]);
        expect(annex.sections[2]!.table!.rows).toHaveLength(result.steps.length);
        expect(annex.sections[4]!.table!.rows[0]).toEqual(["Monto actualizado", "1100.00"]);
        const last = annex.sections.at(-1)!.content!;
        expect(last).toContain("ana@example.com");
        expect(last).toContain("08/11/2026");
        expect(last).toContain("No es una opinión jurídica");
    });

    it("marks an unlocatable quote and truncates a long excerpt", () => {
        expect(describeSource({ status: "document_unverified", filename: "a.docx" })).toContain("sin verificar");
        expect(describeSource({ status: "document_verified", filename: "a", excerpt: "x".repeat(400) })).toContain("…");
        expect(describeSource(undefined)).toBe("Sin fuente");
        expect(describeSource({ status: "person_unverified" })).toContain("No encontrado en tu mensaje");
    });

    it("does not claim every figure has a source when one may have none", () => {
        expect(annexDisclaimer()).not.toContain("proviene de la fuente que se indica");
        expect(annexDisclaimer()).toContain("junto a cada dato se indica su fuente, o que no la tiene");
        expect(annexDisclaimer(methodologyText("en-US"))).toContain("next to each item its source is shown, or that it has none");
    });

    it("dates the annex in Mexico City, not in UTC", () => {
        // 02:30 UTC on the 9th is still the evening of the 8th in Mexico City.
        const late = buildAnnex(result, { sources: {}, generatedAt: new Date("2026-11-09T02:30:00Z"), generatedFor: "a@b.mx" });
        expect(late.sections.at(-1)!.content).toContain("el 08/11/2026 (hora de la Ciudad de México)");
        const noon = buildAnnex(result, { sources: {}, generatedAt: new Date("2026-07-01T12:00:00Z"), generatedFor: "a@b.mx" });
        expect(noon.sections.at(-1)!.content).toContain("el 01/07/2026 ");
        expect(noon.sections.at(-1)!.content).not.toContain("UTC");
    });

    it("writes the whole annex in English for an en-US profile, with the dates in US order", () => {
        const text = methodologyText("en-US");
        const dated = calculate(
            "simple_interest",
            { principal: "1000", rate_percent: "12", start_date: "2026-01-31", end_date: "2026-03-02", day_basis: "360" },
            text,
        );
        const annex = buildAnnex(dated, {
            sources: { principal: { status: "person_unverified" } },
            basis: "Artículo 2395",
            generatedAt: new Date("2026-11-09T02:30:00Z"),
            generatedFor: "",
            text,
        });
        expect(annex.title).toBe("Methodology annex - Simple interest by days");
        expect(annex.sections.map((s) => s.heading)).toEqual([
            "Source data", "Formula", "Steps", "Rounding rule", "Result", "Stated legal basis", "Generation",
        ]);
        expect(annex.sections[0]!.table!.rows[2]).toEqual(["Start date", "01/31/2026", "No source"]);
        expect(annex.sections[0]!.table!.rows[0]![2]).toBe("Not found in your message (unverified)");
        expect(annex.sections[2]!.table!.rows[0]).toEqual(["1. Calendar days", "03/02/2026 − 01/31/2026", "30"]);
        expect(annex.sections[5]!.content).toContain("Status: unverified.");
        expect(annex.sections.at(-1)!.content).toContain("on 11/08/2026 (Mexico City time)");
        expect(annex.sections.at(-1)!.content).toContain("for the user");
        // Figures keep the same digits in every language: no thousands separators.
        const big = calculate("index_update", { amount: "1234567.89", initial_index: "1", final_index: "1" }, text);
        expect(big.result.value).toBe("1234567.89");
    });

    it("has every message used by the calculators and the annex in both catalogs, in tú", () => {
        for (const locale of ["en-US", "es-MX"] as const) {
            const text = methodologyText(locale);
            const names: Record<string, Record<string, string>> = {
                simple_interest: { principal: "1", rate_percent: "1", periods: "1" },
                compound_interest: { principal: "1", rate_percent: "1", periods: "2" },
                index_update: { amount: "1", initial_index: "1", final_index: "2" },
                proportion: { numerator: "1", denominator: "2" },
            };
            for (const [name, given] of Object.entries(names)) {
                const out = calculate(name as never, given, text);
                const annex = buildAnnex(out, { sources: {}, basis: "x", generatedAt: new Date(), generatedFor: "a@b.mx", text });
                expect(JSON.stringify(annex)).not.toContain("training.criterion");
            }
        }
        expect(methodologyText("fr-FR").locale).toBe("es-MX");
        expect(methodologyText(undefined).locale).toBe("es-MX");
        expect(describeSource({ status: "person_unverified" })).toContain("tu mensaje");
    });

    it("reads the person's language from the profile and falls back to es-MX", async () => {
        const db = (row: unknown, error: unknown = null) => ({
            from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
        });
        expect(await readAnnexLocale(db({ ui_locale: "en-US" }), "u")).toBe("en-US");
        expect(await readAnnexLocale(db({ ui_locale: null }), "u")).toBe("es-MX");
        expect(await readAnnexLocale(db({ ui_locale: "fr-FR" }), "u")).toBe("es-MX");
        expect(await readAnnexLocale(db(null), "u")).toBe("es-MX");
        expect(await readAnnexLocale(db({ ui_locale: "en-US" }, { code: "42703" }), "u")).toBe("es-MX");
        expect(await readAnnexLocale({ from: () => { throw new Error("down"); } }, "u")).toBe("es-MX");
    });

    it("looks for a figure in the person's message by its digits, not as a piece of another", () => {
        expect(appearsInMessage("1000", "presté $1,000 al 12 %")).toBe(true);
        expect(appearsInMessage("1000000", "son 1 000 000")).toBe(false);
        expect(appearsInMessage("12.5", "tasa de 12.5 anual")).toBe(true);
        expect(appearsInMessage("100", "son 1000 y 0.100")).toBe(false);
        expect(appearsInMessage("2026-01-31", "hasta el 2026-01-31")).toBe(true);
        expect(appearsInMessage("", "algo")).toBe(false);
    });

    it("never calls a legal basis verified unless a verified quote names it", () => {
        const sources = { amount: { status: "document_verified", filename: "c", excerpt: "conforme al artículo 2395 del Código" } satisfies InputSource };
        expect(verifyBasis("artículo 2395", sources)).toBe("backed");
        expect(verifyBasis("artículo 2396", sources)).toBe("unverified");
        expect(verifyBasis("artículos 2395 y 2396", sources)).toBe("unverified");
        expect(verifyBasis("la ley aplicable", sources)).toBe("unverified");
        expect(verifyBasis("artículo 2395", { amount: { status: "person" } })).toBe("unverified");
        const annex = buildAnnex(result, {
            sources: {},
            basis: "artículo 2395",
            generatedAt: new Date(0),
            generatedFor: "x",
        });
        expect(annex.sections.find((s) => s.heading === "Fundamento indicado")!.content).toContain("sin verificar");
    });
});

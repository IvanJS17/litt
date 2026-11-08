import { describe, expect, it } from "vitest";
import { lawReferences, legalReferences, lawOfTitle, normalizeLaw, hasKnownLaw } from "./legalReferences";
import * as before from "./__tests__/legalReferences.before";

// Results recorded from the implementation before the ReDoS rewrite of its patterns:
// the rewrite must not change them.
const CASES: [string, string[], string[]][] = [
    ["artículo 5 de la Ley Federal del Trabajo",
        ["art:5"],
        ["art:5@ley federal trabajo"]],
    ["Art. 14 bis, fracción III, del artículo 123 constitucional",
        ["art:14bis", "art:14bis:fr:3", "art:123", "art:123:fr:3"],
        ["art:14bis@?", "art:14bis:fr:3@?", "art:123@constitucion politica estados unidos mexicanos", "art:123:fr:3@constitucion politica estados unidos mexicanos"]],
    ["artículos 1, 2 y 3 de la LFT; art. 10 a 12 del Código Civil",
        ["art:1", "art:2", "art:3", "art:10", "art:11", "art:12"],
        ["art:1@ley federal trabajo", "art:2@ley federal trabajo", "art:3@ley federal trabajo", "art:10@codigo civil", "art:11@codigo civil", "art:12@codigo civil"]],
    ["fracciones I y II del artículo 7 de la Ley del Impuesto sobre la Renta",
        ["art:7", "art:7:fr:1", "art:7:fr:2"],
        ["art:7@ley impuesto sobre renta", "art:7:fr:1@ley impuesto sobre renta", "art:7:fr:2@ley impuesto sobre renta"]],
    ["registro digital 2012345, registro no. 2023456 y registros núm: 2034567",
        ["registro:2012345", "registro:2023456", "registro:2034567"],
        ["registro:2012345", "registro:2023456", "registro:2034567"]],
    ["Registro Digital Nº: 2045678; registro  :  2056789",
        ["registro:2056789"],
        ["registro:2056789"]],
    ["tesis: 1a./J. 12/2020 y jurisprudencia aislada P./J. 5/2019",
        ["tesis:1a./j.12/2020", "tesis:jurisprudenciaaisladap./j.5/2019", "tesis:p./j.5/2019"],
        ["tesis:1a./j.12/2020", "tesis:jurisprudenciaaisladap./j.5/2019", "tesis:p./j.5/2019"]],
    ["Tesis aislada : I.3o.C.123 C, jurisprudencia 2a./J. 3/2021",
        ["tesis:i.3o.c.123", "tesis:jurisprudencia2a./j.3/2021", "tesis:2a./j.3/2021"],
        ["tesis:i.3o.c.123", "tesis:jurisprudencia2a./j.3/2021", "tesis:2a./j.3/2021"]],
    ["\"Artículo 5\", (Ley de Amparo). «art. 6 de la Ley de Amparo», 'art. 7 CPEUM'.",
        ["art:5", "art:6", "art:7"],
        ["art:5@ley sede", "art:6@ley amparo", "art:7@constitucion politica estados unidos mexicanos"]],
    ["art.\t5\t,\tfr.\tIV\t,\tdel\tart.\t6\tde\tla\tLey Federal del Trabajo",
        ["art:5", "art:5:fr:4", "art:6", "art:6:fr:4"],
        ["art:5@?", "art:5:fr:4@?", "art:6@ley federal trabajo", "art:6:fr:4@ley federal trabajo"]],
    ["(\"art. 8 de la Constitución.\") registros digitales 2099999",
        ["art:8", "registro:2099999"],
        ["art:8@constitucion politica estados unidos mexicanos", "registro:2099999"]],
    ["art. 9, de la Ley General de Salud y artículo 10 según la Ley Agraria",
        ["art:9", "art:10"],
        ["art:9@ley general salud", "art:10@ley agraria"]],
    ["artículo 5 según la ley",
        ["art:5"],
        ["art:5@?"]],
    ["artículo 16 ley",
        ["art:16"],
        ["art:16@ley sede"]],
    ["artículo 3o. constitucional; artículo 17a del CFF",
        ["art:3", "art:17a"],
        ["art:3@constitucion politica estados unidos mexicanos", "art:17a@codigo fiscal federacion"]],
];

describe("legalReferences pattern rewrite keeps the results", () => {
    it.each(CASES)("%j", (text, plain, withLaw) => {
        expect([...legalReferences(text)]).toEqual(plain);
        expect([...lawReferences(text, "ley sede")]).toEqual(withLaw);
    });
});

describe("legalReferences on hostile input", () => {
    const BUDGET_MS = 200;
    const timed = (run: () => unknown): number => {
        const started = performance.now();
        run();
        return performance.now() - started;
    };

    it.each([
        ["registro followed by 50 000 tabs", "registro" + "\t".repeat(50_000) + "x"],
        ["tesis followed by 50 000 tabs", "tesis" + "\t".repeat(50_000) + "x"],
        ["article followed by 20 000 tabs", "art\u00edculo 5" + "\t".repeat(20_000) + "x"],
        ["fraction followed by 20 000 tabs", "art\u00edculo 5, fr." + "\t".repeat(20_000) + "x"],
        ["a word of 50 000 quotes and a letter", '"'.repeat(50_000) + "a"],
        ["a letter and 50 000 closing quotes", "ley a" + '"'.repeat(50_000) + "a"],
        ["article of the law, tabs between", "art\u00edculo 5" + " de".repeat(10) + "\t".repeat(20_000) + "x"],
    ])("%s stays linear", (_name, text) => {
        expect(timed(() => legalReferences(text))).toBeLessThan(BUDGET_MS);
        expect(timed(() => lawReferences(text))).toBeLessThan(BUDGET_MS);
    });
});

describe("rewritten heads match exactly what the previous patterns matched", () => {
    const OLD_REGISTRY = /\bregistros?(?:\s+digital(?:es)?)?\s*(?:(?:no\.?|num\.?|nums\.?|numeros?)\s*)?(?::\s*)?/g;
    const NEW_REGISTRY = /\bregistros?\s*(?:(?<=\s)digital(?:es)?\s*)?(?:(?:no\.?|num\.?|nums\.?|numeros?)\s*)?(?::\s*)?/g;
    const OLD_THESIS = /\b(?:tesis|jurisprudencias?)(?:\s+aisladas?)?\s*(?::\s*)?/g;
    const NEW_THESIS = /\b(?:tesis|jurisprudencias?)\s*(?:(?<=\s)aisladas?\s*)?(?::\s*)?/g;

    const matches = (re: RegExp, text: string): [number, number][] => {
        re.lastIndex = 0;
        const out: [number, number][] = [];
        for (let m = re.exec(text); m; m = re.exec(text)) {
            out.push([m.index, m[0].length]);
            if (m[0].length === 0) re.lastIndex += 1;
        }
        return out;
    };

    const generate = (seed: number, head: string[], tail: string[], count: number): string[] => {
        let state = seed >>> 0;
        const next = (n: number): number => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state % n;
        };
        const alphabet = [...head, " ", "\t", ...tail, "no.", "num", "n\u00fameros", ":", "123456", "x"];
        return Array.from({ length: count }, () =>
            Array.from({ length: 1 + next(8) }, () => alphabet[next(alphabet.length)]).join(""));
    };

    it.each([
        ["registry", OLD_REGISTRY, NEW_REGISTRY, ["registro", "registros"], ["digital", "digitales"]],
        ["thesis", OLD_THESIS, NEW_THESIS, ["tesis", "jurisprudencia", "jurisprudencias"], ["aislada", "aisladas"]],
    ] as const)("%s head: identical position and length on 60 000 strings", (_n, oldRe, newRe, head, tail) => {
        const strings = generate(20260508, [...head], [...tail], 60_000);
        expect(strings.length).toBe(60_000);
        let withMatch = 0;
        for (const text of strings) {
            const before = matches(oldRe, text);
            if (before.length > 0) withMatch += 1;
            expect(matches(newRe, text), JSON.stringify(text)).toEqual(before);
        }
        expect(withMatch).toBeGreaterThan(10_000);
    });

    it("does not read digital glued to the word", () => {
        expect(matches(NEW_REGISTRY, "registrodigital 5")).toEqual(matches(OLD_REGISTRY, "registrodigital 5"));
        expect(matches(NEW_REGISTRY, "registrosdigitales 5")).toEqual(matches(OLD_REGISTRY, "registrosdigitales 5"));
    });
});

describe("registry head on tabs followed by a near miss", () => {
    it("stays linear", () => {
        const text = "registro" + "\t".repeat(50_000) + "digitax";
        const started = performance.now();
        legalReferences(text);
        lawReferences(text);
        expect(performance.now() - started).toBeLessThan(200);
    });
});

// CodeQL alert 76: every pattern read through sticky() starts with `^` now, instead of
// relying on the `y` flag (which the analysis does not model). The previous module is
// frozen in __tests__/legalReferences.before.ts; nothing the exports return may change.
describe("anchored sticky patterns give the results of the previous module", () => {
    const PIECES = [
        " ", " ", "\t", ",", ", ", " y ", " e ", " o ", " u ", "y", "a", " a ", " al ", " hasta el ", " hasta ",
        "fracción ", "fracciones ", "fr. ", "fracc. ", ", fr. ", "del artículo ", "de los arts. ", "del art. ", "de los artículos ",
        "artículo ", "artículos ", "arts. ", "art. ", "constitucional", " constitucional ", " local", " de Tlaxcala",
        "de la Ley Federal del Trabajo", " de la ", " del ", " de ", " según la ", " en el ", "Ley ", "Código Civil", "LFT", "CPEUM",
        "Constitución", " Carta Magna", " de 1917", " de acuerdo con ",
        "artículo 5 de la LFT", "art. 7 CPEUM", "artículo 3 constitucional", "arts. 1, 2 y 3 del Código Civil Federal",
        "1", "2", "5", "10", "123", "1949", "2o.", "3º", "14", " bis", " ter", "17a", "I", "II", "IV", "VII", "XIV", "iii", "x",
        "tesis ", "jurisprudencia ", "aislada ", "1a./J. 12/2020", "I.3o.C.123 C", "P./J. 5/2019", " C", " (c) ",
        "registro ", "registros digitales ", "no. ", "2012345", "20", ":", ".", "/", "-", "0", "00", "a", "b", "ñ", "Ñ", "É",
    ];
    const generate = (seed: number, count: number): string[] => {
        let state = seed >>> 0;
        const next = (n: number): number => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return (state >>> 8) % n;
        };
        return Array.from({ length: count }, () =>
            Array.from({ length: 1 + next(14) }, () => PIECES[next(PIECES.length)]).join(""));
    };

    // Two later fixes change the result of some strings on purpose, always away from the CPEUM (fail
    // closed): a neutral connector («de acuerdo con», «de conformidad con», «de 1917») followed by
    // anything but the end, punctuation or a word that qualifies nothing, and «constitucional de la
    // Constitución …» (a qualified constitution). Those strings are compared by that rule instead of by
    // equality: each key either equals the previous one or is the previous CPEUM key turned into one of
    //  - «@?», the law is unknown (a qualified constitution), or
    //  - «@constitucion 1917», a law of its own name (a capitalized «Constitución de 1917» that
    //    something qualifies: «de 1917 aplicable en Tlaxcala»).
    // A key never turns into anything else, and never from a law that was not the CPEUM.
    const CPEUM_SUFFIX = "@constitucion politica estados unidos mexicanos";
    const TURNED_SUFFIXES = ["@?", "@constitucion 1917"];
    const DIVERGENCE_CAUSE = /de acuerdo con|de conformidad con|de 1917|constitucional/i;
    const onlyTowardsUnknown = (now: string[], previous: string[]): boolean => {
        const old = new Set(previous);
        const turned = new Set(
            previous
                .filter((key) => key.endsWith(CPEUM_SUFFIX))
                .flatMap((key) => TURNED_SUFFIXES.map((suffix) => `${key.slice(0, -CPEUM_SUFFIX.length)}${suffix}`)),
        );
        return now.length === previous.length && now.every((key) => old.has(key) || turned.has(key));
    };

    it("a capitalized «Constitución de 1917» followed by punctuation keeps the result of the previous module; one that something qualifies only turns away from the CPEUM", () => {
        const same = [
            "Artículo 5 de la Constitución de 1917.",
            "artículo 5 de la Constitución de 1917, dice",
            "artículo 5 de la Constitución de 1917; dice",
            "¿Qué dice el artículo 5 de la Constitución de 1917?",
            "artículo 5 de la Constitución de 1917",
            "artículo 5 de la Constitución de 1917 establece",
            "artículo 5 de la constitución de 1917.",
            "artículo 5 de la Constitución de 1917 de Tlaxcala",
            "artículo 5 de la Constitución de 1917 local",
        ];
        for (const text of same) expect([...lawReferences(text, null)], text).toEqual([...before.lawReferences(text, null)]);
        const qualified = ["artículo 5 de la Constitución de 1917 aplicable en Tlaxcala", "artículo 5 de la Constitución de 1917 aplicable."];
        for (const text of qualified) {
            const now = [...lawReferences(text, null)];
            const previous = [...before.lawReferences(text, null)];
            expect(now, text).not.toEqual(previous);
            expect(onlyTowardsUnknown(now, previous), text).toBe(true);
            expect(now.some((key) => key.endsWith(CPEUM_SUFFIX)), text).toBe(false);
        }
        // The rule is exact: it does not excuse a key that was not the CPEUM, nor any other target.
        expect(onlyTowardsUnknown(["art:5@ley b"], ["art:5@ley a"])).toBe(false);
        expect(onlyTowardsUnknown(["art:5@constitucion 1917"], ["art:5@ley a"])).toBe(false);
        expect(onlyTowardsUnknown(["art:5@ley b"], [`art:5${CPEUM_SUFFIX}`])).toBe(false);
        expect(onlyTowardsUnknown(["art:5@?"], [`art:5${CPEUM_SUFFIX}`])).toBe(true);
        expect(onlyTowardsUnknown(["art:5@constitucion 1917"], [`art:5${CPEUM_SUFFIX}`])).toBe(true);
    });

    it("legalReferences, lawReferences and the law helpers agree on 60 000 strings", { timeout: 120_000 }, () => {
        let diverged = 0;
        const strings = generate(20261108, 60_000);
        expect(strings.length).toBeGreaterThanOrEqual(50_000);
        let withReferences = 0;
        let withLaw = 0;
        for (const text of strings) {
            const previous = [...before.legalReferences(text)];
            expect([...legalReferences(text)], JSON.stringify(text)).toEqual(previous);
            if (previous.length > 0) withReferences += 1;
            for (const source of [null, "ley sede"]) {
                const strict = [...before.lawReferences(text, source)];
                const now = [...lawReferences(text, source)];
                if (JSON.stringify(now) !== JSON.stringify(strict)) {
                    expect(DIVERGENCE_CAUSE.test(text), JSON.stringify([text, source])).toBe(true);
                    expect(onlyTowardsUnknown(now, strict), JSON.stringify([text, source, now, strict])).toBe(true);
                    diverged += 1;
                }
                if (source === null && strict.some((key) => key.startsWith("art:") && before.hasKnownLaw(key))) withLaw += 1;
            }
            expect(lawOfTitle(text), JSON.stringify(text)).toBe(before.lawOfTitle(text));
            expect(normalizeLaw(text), JSON.stringify(text)).toBe(before.normalizeLaw(text));
            expect(hasKnownLaw(text)).toBe(before.hasKnownLaw(text));
        }
        expect(withReferences).toBeGreaterThan(8_000);
        expect(withLaw).toBeGreaterThan(1_000);
        // The intentional divergences stay a small minority (the other strings are equal).
        expect(diverged).toBeLessThan(2_000);
    });

    const TABS = "\t".repeat(50_000);
    it.each([
        ["list separator", "artículo 5" + TABS + ", y 6"],
        ["list separator, word form", "artículo 5" + TABS + " y 6"],
        ["range separator", "artículo 5" + TABS + " a 7"],
        ["fraction after the article", "artículo 5" + TABS + ", fracción II"],
        ["fraction of the article", "fracción II" + TABS + ", del artículo 6"],
        ["thesis subject", "tesis I.3o.C.123" + TABS + "C, y I.4o.C.5 C"],
        ["law separator", "artículo 5" + TABS + "de la Ley Federal del Trabajo"],
        ["constitutional adjective", "artículo 5" + TABS + "constitucional" + TABS + "local"],
        ["law written bare", "artículo 5" + TABS + "(lft"],
        ["near misses", "artículo 5" + TABS + "x"],
        ["long digits", "tesis " + "0".repeat(50_000) + "/x"],
        ["long digits, registry", "registro " + "0".repeat(50_000)],
        ["long dotted run", "tesis " + "0.".repeat(25_000) + "x"],
    ])("%s on 50 000 characters stays linear", (_name, text) => {
        const started = performance.now();
        legalReferences(text);
        lawReferences(text);
        expect(performance.now() - started).toBeLessThan(400);
    });
});

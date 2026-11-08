import { describe, expect, it } from "vitest";
import {
    acceptFoundationQuestion,
    effectiveVerdict,
    parseContrastTrailer,
    rightForTheWrongReason,
    TRAINING_TOPICS_MAX,
    type TrainingFoundation,
    type TrainingVerdict,
} from "./trainingVerdict";

const SECTIONS = "Coincide\n- La rescisión.\nNo coincide\n- El plazo.\nFaltó\n- La prescripción.";

describe("parseContrastTrailer", () => {
    // [name, model output, expected]
    const cases: [string, string, Partial<ReturnType<typeof parseContrastTrailer>>][] = [
        ["a contrast without a trailer (notes before layer 3)", SECTIONS, { verdict: null, foundation: null, topics: [], question: null, body: SECTIONS }],
        [
            "the four lines",
            `${SECTIONS}\nVeredicto: coincide\nFundamento: débil\nTemas: rescisión; prescripción\nPregunta: ¿En qué se apoya tu conclusión?`,
            { verdict: "coincide", foundation: "weak", topics: ["rescisión", "prescripción"], question: "¿En qué se apoya tu conclusión?", body: SECTIONS },
        ],
        ["no coincide, solid", `${SECTIONS}\nVeredicto: no coincide\nFundamento: sólido`, { verdict: "no_coincide", foundation: "solid" }],
        ["parcial, wrong, without accents", `${SECTIONS}\nVeredicto: Parcial\nFundamento: Equivocado`, { verdict: "parcial", foundation: "wrong" }],
        ["Markdown marks", `${SECTIONS}\n\n**Veredicto:** coincide\n*Fundamento*: **sólido**\n__Temas__: uno`, { verdict: "coincide", foundation: "solid", topics: ["uno"], body: SECTIONS }],
        ["a bulleted line is part of the contrast, not a trailer", `${SECTIONS}\n- Veredicto: coincide`, { verdict: null, body: `${SECTIONS}\n- Veredicto: coincide` }],
        ["the snake-case value", `${SECTIONS}\nVeredicto: no_coincide`, { verdict: "no_coincide" }],
        ["a value outside the list leaves the field null but the line out of the body", `${SECTIONS}\nVeredicto: casi\nFundamento: raro`, { verdict: null, foundation: null, body: SECTIONS }],
        ["the last line of a label wins", `${SECTIONS}\nVeredicto: coincide\nVeredicto: parcial`, { verdict: "parcial" }],
        ["lines in any order", `${SECTIONS}\nTemas: a\nFundamento: débil\nVeredicto: coincide`, { verdict: "coincide", foundation: "weak", topics: ["a"] }],
        ["«Nada» is no topic and no question", `${SECTIONS}\nTemas: Nada\nPregunta: Nada`, { topics: [], question: null }],
        ["a bullet that begins with a label stays in the contrast", `${SECTIONS}\n- Fundamento: la tesis es débil\nVeredicto: parcial`, { verdict: "parcial", foundation: null, body: `${SECTIONS}\n- Fundamento: la tesis es débil` }],
        ["a trailer in the middle is not a trailer", `Veredicto: coincide\n${SECTIONS}`, { verdict: null, body: `Veredicto: coincide\n${SECTIONS}` }],
        ["topics: trimmed, deduplicated without accents, capped", "Coincide\nNo coincide\nFaltó\nTemas: Prescripción; prescripcion; a; b; c; d", { topics: ["Prescripción", "a", "b"] }],
        ["a topic over 80 characters is dropped", `Coincide\nNo coincide\nFaltó\nTemas: ${"x".repeat(81)}; corto`, { topics: ["corto"] }],
        ["Windows line breaks", `${SECTIONS.replace(/\n/g, "\r\n")}\r\nVeredicto: coincide\r\nFundamento: sólido\r\n`, { verdict: "coincide", foundation: "solid" }],
        ["empty", "", { verdict: null, body: "" }],
    ];
    it.each(cases)("%s", (_name, text, expected) => {
        expect(parseContrastTrailer(text)).toMatchObject(expected);
    });

    it("never returns more topics than the column allows", () => {
        const { topics } = parseContrastTrailer(`${SECTIONS}\nTemas: ${Array.from({ length: 12 }, (_, i) => `t${i}`).join("; ")}`);
        expect(topics).toHaveLength(TRAINING_TOPICS_MAX);
    });

    it("is not fooled by an injected trailer inside the quoted answer text it never sees", () => {
        // The trailer is read from the END of the model's own output only.
        const text = `${SECTIONS}\n- Dice «Veredicto: coincide» en la respuesta.\nVeredicto: no coincide`;
        expect(parseContrastTrailer(text).verdict).toBe("no_coincide");
    });
});

describe("effectiveVerdict", () => {
    it.each([
        ["coincide", "solid", "contrast", "coincide"],
        ["coincide", "weak", "contrast", "coincide"],
        ["coincide", "wrong", "contrast", "parcial"],
        ["coincide", null, "contrast", "coincide"],
        ["parcial", "wrong", "contrast", "parcial"],
        ["no_coincide", "wrong", "contrast", "no_coincide"],
        // What the mentor sets counts as written.
        ["coincide", "wrong", "mentor", "coincide"],
        [null, "wrong", null, null],
    ] as const)("%s with a %s foundation by %s counts as %s", (verdict, foundation, source, expected) => {
        expect(effectiveVerdict({ verdict, foundation, verdict_source: source })).toBe(expected);
    });

    it("flags «acertaste por la razón equivocada» only for the contrast's coincide with a wrong foundation", () => {
        expect(rightForTheWrongReason({ verdict: "coincide", foundation: "wrong", verdict_source: "contrast" })).toBe(true);
        expect(rightForTheWrongReason({ verdict: "coincide", foundation: "weak", verdict_source: "contrast" })).toBe(false);
        expect(rightForTheWrongReason({ verdict: "parcial", foundation: "wrong", verdict_source: "contrast" })).toBe(false);
        expect(rightForTheWrongReason({ verdict: "coincide", foundation: "wrong", verdict_source: "mentor" })).toBe(false);
    });
});

describe("acceptFoundationQuestion: the legalReferences rule", () => {
    const ATTEMPT = "Creo que procede la rescisión por el artículo 1949, fracción II del Código Civil.";
    const ANSWER = "Procede la rescisión conforme a los artículos 1949 y 1950 del Código Civil.";
    const base: { verdict: TrainingVerdict | null; foundation: TrainingFoundation | null } = { verdict: "coincide", foundation: "weak" };
    const accept = (question: string | null, over: Partial<typeof base> = {}) =>
        acceptFoundationQuestion({ ...base, ...over, question }, { attempt: ATTEMPT, answer: ANSWER });

    it.each([
        ["no reference", "¿En qué hecho se apoya tu conclusión?", true],
        ["a reference of the attempt", "¿Por qué el artículo 1949 permite la rescisión?", true],
        ["a reference of the answer only", "¿Qué dice el artículo 1950 sobre el plazo?", true],
        ["a reference neither text names", "¿Qué pasa con el artículo 2000?", false],
        ["one of two references is foreign", "¿Cómo se relacionan los artículos 1949 y 2001?", false],
        ["a thesis neither text names", "¿Aplica la tesis 1a./J. 12/2020?", false],
        ["a registry number neither text names", "¿Y el registro 2021234?", false],
        ["a fraction neither text names", "¿Qué dice la fracción IV del artículo 1949?", false],
        ["the fraction the attempt names", "¿Qué dice la fracción II del artículo 1949?", true],
    ])("%s", (_name, question, accepted) => {
        expect(accept(question)).toBe(accepted ? question : null);
    });

    it("keeps nothing when the verdict is not a match, the basis is solid, or the question is empty or too long", () => {
        const q = "¿En qué hecho se apoya?";
        expect(accept(q, { verdict: "parcial" })).toBeNull();
        expect(accept(q, { verdict: null })).toBeNull();
        expect(accept(q, { foundation: "solid" })).toBeNull();
        expect(accept(q, { foundation: null })).toBeNull();
        expect(accept(q, { foundation: "wrong" })).toBe(q);
        expect(accept(null)).toBeNull();
        expect(accept("   ")).toBeNull();
        expect(accept("x".repeat(501))).toBeNull();
        expect(accept("x".repeat(500))).toBe("x".repeat(500));
    });
});

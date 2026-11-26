import { describe, expect, it } from "vitest";
import {
    answerProse,
    buildCitationSupportInputs,
    claimForRef,
    contextAround,
    MAX_CHECKED_CITATIONS,
    MAX_CONTEXT_CHARS,
} from "../inputs";

describe("claimForRef", () => {
    const prose =
        "El contrato es de arrendamiento. La renta mensual es de $12,000 [1]. El plazo es de 30 días y se paga por adelantado [2][3]. Nada más.";

    it("takes the sentence that carries the marker", () => {
        expect(claimForRef(prose, 1)).toBe("La renta mensual es de $12,000");
        expect(claimForRef(prose, 2)).toBe("El plazo es de 30 días y se paga por adelantado");
        expect(claimForRef(prose, 3)).toBe("El plazo es de 30 días y se paga por adelantado");
    });

    it("takes the sentence before a marker that stands after the full stop", () => {
        expect(claimForRef("Primera idea. La multa es del 5 %. [1]", 1)).toBe("La multa es del 5 %.");
    });

    it("handles the first sentence, bold text and lists", () => {
        expect(claimForRef("**Plazo:** treinta días [1].", 1)).toBe("Plazo: treinta días");
        expect(claimForRef("Resumen:\n- Pago en 5 días hábiles [1]\n- Otro dato [2]", 1)).toBe("- Pago en 5 días hábiles");
    });

    it("takes a whole table row", () => {
        const table = "| Cláusula | Valor |\n| --- | --- |\n| Plazo | 30 días [1] |\n";
        expect(claimForRef(table, 1)).toBe("Plazo 30 días");
    });

    it("is null when the marker is not in the prose, and does not take [[1]] or [12] for [1]", () => {
        expect(claimForRef("Algo [12].", 1)).toBeNull();
        expect(claimForRef("Algo [[1]].", 1)).toBeNull();
        expect(claimForRef("Sin marcas.", 1)).toBeNull();
    });

    it("keeps a long claim within bounds", () => {
        expect(claimForRef(`${"a".repeat(2_000)} [1]`, 1)!.length).toBe(700);
    });
});

describe("answerProse", () => {
    it("drops the CITATIONS block", () => {
        expect(answerProse("Texto [1]\n<CITATIONS>[{}]</CITATIONS>", "<CITATIONS>")).toBe("Texto [1]\n");
        expect(answerProse("Sin bloque", "<CITATIONS>")).toBe("Sin bloque");
    });
});

describe("contextAround", () => {
    it("is the quote's paragraph when it is short", () => {
        const source = "Uno.\nDos es la cita aquí. Y sigue.\nTres.";
        const start = source.indexOf("Dos");
        expect(contextAround(source, start, start + 18)).toBe("Dos es la cita aquí. Y sigue.");
    });

    it("is a window of about 450 characters either side, on sentence ends, when the paragraph is long", () => {
        const sentence = "Una frase de relleno con palabras. ";
        const source = sentence.repeat(100) + "CITA EXACTA. " + sentence.repeat(100);
        const start = source.indexOf("CITA EXACTA.");
        const context = contextAround(source, start, start + 12);
        expect(context).toContain("CITA EXACTA.");
        expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
        expect(context.length).toBeLessThan(1_000);
        expect(context.startsWith("Una frase")).toBe(true);
        expect(context.endsWith(".")).toBe(true);
    });
});

describe("the technical cap on the context", () => {
    it("is a technical ceiling at the pilot's largest context", () => {
        expect(MAX_CONTEXT_CHARS).toBe(1_400);
    });

    it("holds for a paragraph just over the cap, a huge one and a quote longer than the cap", () => {
        for (const size of [999, 1_000, 1_001, 5_000, 200_000]) {
            const source = "x".repeat(size);
            const start = Math.floor(size / 2);
            expect(contextAround(source, start, start + 50).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
        }
        const long = "palabra. ".repeat(500);
        expect(contextAround(long, 0, long.length).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    });

    it("holds in the state that is sent, however many quotes the citation has", async () => {
        const para = (n: number) => `${"Texto del párrafo. ".repeat(80)}CITA${n}.`;
        const source = Array.from({ length: 6 }, (_, n) => para(n)).join("\n");
        const quotes = Array.from({ length: 6 }, (_, n) => {
            const quote = `CITA${n}.`;
            const start = source.indexOf(quote);
            return { quote, verification: { verified: true, start_char: start, end_char: start + quote.length, source_excerpt: quote } };
        });
        const [input] = await buildCitationSupportInputs({
            prose: "Varias cosas [1].",
            citations: [{ ref: 1, doc_id: "d", quotes }],
            getSourceText: async () => source,
        });
        expect(input.state.contexto.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
        expect(input.state.contexto.length).toBeGreaterThan(0);
    });
});

describe("buildCitationSupportInputs", () => {
    const source = "Cláusula primera.\nLa renta mensual será de $12,000.00 pesos.\nCláusula segunda.\nEl plazo es de 30 días.";
    const verified = (quote: string) => {
        const start = source.indexOf(quote);
        return { quote, verification: { verified: true, start_char: start, end_char: start + quote.length, source_excerpt: quote } };
    };
    const citation = (ref: number, quotes: unknown[], extra: Record<string, unknown> = {}) => ({
        ref,
        doc_id: "doc-0",
        document_id: "11111111-1111-4111-8111-111111111111",
        version_id: "22222222-2222-4222-8222-222222222222",
        quotes,
        ...extra,
    });
    const getSourceText = async () => source;

    it("builds the pilot's state for each verified citation", async () => {
        const inputs = await buildCitationSupportInputs({
            prose: "La renta es de $12,000 [1]. El plazo es de 30 días [2].",
            citations: [
                citation(1, [verified("La renta mensual será de $12,000.00 pesos.")]),
                citation(2, [verified("El plazo es de 30 días.")]),
            ],
            getSourceText,
        });
        expect(inputs).toHaveLength(2);
        expect(inputs[0]).toMatchObject({
            ref: 1,
            documentId: "11111111-1111-4111-8111-111111111111",
            versionId: "22222222-2222-4222-8222-222222222222",
            state: {
                afirmacion: "La renta es de $12,000",
                cita: "La renta mensual será de $12,000.00 pesos.",
                contexto: "La renta mensual será de $12,000.00 pesos.",
            },
        });
        expect(inputs[0].startChar).toBe(source.indexOf("La renta mensual"));
        expect(Object.keys(inputs[0].state)).toEqual(["afirmacion", "cita", "contexto"]);
    });

    it("joins the quotes of one citation into one input", async () => {
        const [input] = await buildCitationSupportInputs({
            prose: "Renta y plazo [1].",
            citations: [citation(1, [verified("La renta mensual será de $12,000.00 pesos."), verified("El plazo es de 30 días.")])],
            getSourceText,
        });
        expect(input.state.cita).toBe("La renta mensual será de $12,000.00 pesos.\n[...]\nEl plazo es de 30 días.");
        expect(input.endChar).toBe(source.indexOf("El plazo es de 30 días.") + "El plazo es de 30 días.".length);
    });

    it("skips what cannot be checked: unverified quotes, a missing marker, an unreadable document", async () => {
        const unverified = { quote: "No está", verification: { verified: false } };
        const inputs = await buildCitationSupportInputs({
            prose: "Uno [1]. Dos [2]. Cuatro [4].",
            citations: [
                citation(1, [unverified]),
                citation(2, [verified("El plazo es de 30 días.")], { doc_id: "doc-bad" }),
                citation(3, [verified("El plazo es de 30 días.")]),
                citation(4, [verified("El plazo es de 30 días.")]),
                { ref: 5, quotes: [] },
                null,
            ],
            getSourceText: async (id) => {
                if (id === "doc-bad") throw new Error("boom");
                return source;
            },
        });
        expect(inputs.map((i) => i.ref)).toEqual([4]);
    });

    it("checks at most MAX_CHECKED_CITATIONS", async () => {
        const many = Array.from({ length: MAX_CHECKED_CITATIONS + 5 }, (_, i) => citation(i + 1, [verified("El plazo es de 30 días.")]));
        const prose = many.map((c) => `Dato [${c.ref}].`).join(" ");
        const inputs = await buildCitationSupportInputs({ prose, citations: many, getSourceText });
        expect(inputs).toHaveLength(MAX_CHECKED_CITATIONS);
    });

    it("counts a verified citation toward the cap whether or not its claim or its document can be read", async () => {
        const inOrder = (from: number) => Array.from({ length: MAX_CHECKED_CITATIONS }, (_, i) => citation(from + i, [verified("El plazo es de 30 días.")]));
        const last = citation(900, [verified("El plazo es de 30 días.")]);
        // The first group has no marker in the answer: no claim to check.
        const noClaim = await buildCitationSupportInputs({ prose: "Dato [900].", citations: [...inOrder(1), last], getSourceText });
        expect(noClaim).toEqual([]);
        // The second group's document cannot be read.
        const unreadable = await buildCitationSupportInputs({
            prose: `${inOrder(1).map((c) => `Dato [${c.ref}].`).join(" ")} Dato [900].`,
            citations: [...inOrder(1), last],
            getSourceText: async (docId) => { throw new Error(`cannot read ${docId}`); },
        });
        expect(unreadable).toEqual([]);
        const read: number[] = [];
        await buildCitationSupportInputs({
            prose: `${inOrder(1).map((c) => `Dato [${c.ref}].`).join(" ")} Dato [900].`,
            citations: [...inOrder(1), last],
            getSourceText: async () => { read.push(1); throw new Error("unreadable"); },
        });
        expect(read).toHaveLength(MAX_CHECKED_CITATIONS);
    });
});

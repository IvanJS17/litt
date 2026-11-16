import { describe, expect, it } from "vitest";
import { locateQuoteInSource } from "../playbooks.draft";
import { playbookCitationInputs, reviewSourcesFor } from "../playbooks.citationSupport";
import type { PlaybookContent } from "../playbooks.types";

const STORED = "33333333-3333-4333-8333-333333333333";
const CLAUSE = "El arrendatario pagará una pena convencional del diez por ciento sobre la renta vigente.";
const LAW = "Artículo 2118. Las partes pueden pactar libremente el plazo del arrendamiento.";
const sources = [{ label: "A1", text: `Cláusula Décima. ${CLAUSE}\n\n${LAW}\n\nOtra cosa.` }];

const rule = (extra: Record<string, unknown>) => ({
    id: "r", name: "Pena convencional", concept: "Penalidad por mora", scope: "clause", required: false,
    guidance: "", standard: { name: "Estándar", criteria: "Máximo 10% de la renta", sampleClauses: [] },
    fallbacks: [], unacceptable: [], conditions: [], actions: [], ...extra,
});
const content = (rules: unknown[]) =>
    ({ name: "x", description: "", representedParty: "", documentTypes: [], jurisdictions: [], rules: [], topics: [{ id: "t", name: "T", rules }] }) as unknown as PlaybookContent;

describe("playbookCitationInputs", () => {
    it("checks a clause origin and each verified legal reference, in rule order", () => {
        const inputs = playbookCitationInputs({
            content: content([
                rule({
                    origin: { kind: "clause", sourceId: "A1", quote: CLAUSE, unbacked: false },
                    legalRefs: [
                        { text: "Código Civil, art. 2118", sourceId: "A1", quote: LAW, verified: true },
                        { text: "mencionada", verified: false },
                    ],
                }),
            ]),
            sources,
            sourceIds: [STORED],
            locate: locateQuoteInSource,
        });
        expect(inputs.map((i) => i.ref)).toEqual([1, 2]);
        expect(inputs[0].state).toMatchObject({ afirmacion: "Pena convencional: Máximo 10% de la renta", cita: CLAUSE });
        expect(inputs[0].state.contexto).toContain("Cláusula Décima");
        expect(inputs[1].state.afirmacion).toBe("Pena convencional: Código Civil, art. 2118");
        expect(inputs[0].documentId).toBe(STORED);
        const sent = JSON.stringify(inputs.map((i) => i.state));
        expect(sent).not.toContain("A1");
        expect(sent).not.toContain(STORED);
    });

    it("skips rules that stand on an answer or general practice, and quotes it cannot place", () => {
        const inputs = playbookCitationInputs({
            content: content([
                rule({ origin: { kind: "answer", questionIds: ["q1"], unbacked: false } }),
                rule({ origin: { kind: "ai_general", unbacked: true } }),
                rule({ origin: { kind: "clause", sourceId: "A2", quote: CLAUSE, unbacked: false } }),
                rule({ origin: { kind: "clause", sourceId: "A1", quote: "texto que el adjunto no contiene en absoluto", unbacked: false } }),
            ]),
            sources,
            sourceIds: [STORED],
            locate: locateQuoteInSource,
        });
        expect(inputs).toEqual([]);
    });

    it("uses the concept when a rule has no standard", () => {
        const inputs = playbookCitationInputs({
            content: content([rule({ standard: null, origin: { kind: "clause", sourceId: "A1", quote: CLAUSE, unbacked: false } })]),
            sources,
            sourceIds: [],
            locate: locateQuoteInSource,
        });
        expect(inputs[0].state.afirmacion).toBe("Pena convencional: Penalidad por mora");
        expect(inputs[0].documentId).toBeNull();
    });
});

describe("locateQuoteInSource", () => {
    it("finds a quote the way the provenance check does: without accents, case, quotes or spacing", () => {
        const text = "Cláusula  Décima.\n«El Arrendatario»  pagará   la renta.";
        const found = locateQuoteInSource(text, 'clausula decima. "el arrendatario" pagara la renta');
        expect(found).not.toBeNull();
        expect(text.slice(found!.start, found!.end).trim()).toBe(found!.excerpt);
        expect(found!.excerpt).toBe(text.replace(/\.$/, ""));
        expect(locateQuoteInSource(text, "no está aquí")).toBeNull();
        expect(locateQuoteInSource(text, "   ")).toBeNull();
    });
});

describe("reviewSourcesFor", () => {
    const drafted = () =>
        content([
            rule({ id: "r1", origin: { kind: "answer", questionIds: ["q1"], unbacked: false } }),
            rule({
                id: "r2",
                origin: { kind: "clause", sourceId: "A1", quote: CLAUSE, unbacked: false },
                legalRefs: [
                    { text: "Código Civil, art. 2118", sourceId: "A1", quote: LAW, verified: true },
                    { text: "mencionada", verified: false },
                ],
            }),
            rule({ id: "r3", origin: { kind: "clause", sourceId: "A1", quote: CLAUSE, unbacked: false } }),
        ]);
    // The stored draft: the labels are replaced by the stored source id.
    const stored = () =>
        JSON.parse(JSON.stringify(drafted()).replaceAll('"A1"', `"${STORED}"`)) as PlaybookContent;

    it("numbers the quotes exactly as the check did, so a flagged ref lands on its own rule", () => {
        const inputs = playbookCitationInputs({ content: drafted(), sources, sourceIds: [STORED], locate: locateQuoteInSource });
        expect(inputs.map((i) => i.ref)).toEqual([1, 2, 3]);
        expect(reviewSourcesFor(stored(), [1])).toEqual([{ ruleId: "r2", legalIndex: null }]);
        expect(reviewSourcesFor(stored(), [2])).toEqual([{ ruleId: "r2", legalIndex: 0 }]);
        expect(reviewSourcesFor(stored(), [3, 1])).toEqual([
            { ruleId: "r2", legalIndex: null },
            { ruleId: "r3", legalIndex: null },
        ]);
    });

    it("names nothing when there is nothing flagged or the ref is not a quote", () => {
        expect(reviewSourcesFor(stored(), [])).toEqual([]);
        expect(reviewSourcesFor(stored(), [9])).toEqual([]);
    });
});

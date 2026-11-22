import { afterEach, describe, expect, it, vi } from "vitest";
import { expectLinearCost, expectLinearCostAsync } from "../../../__tests__/helpers/linearCost";
import { MODEL_TEXT_MAX_CHARS } from "../../../lib/modelJsonFence";
import {
    cellCitationInputs,
    chatCitationInputs,
    checkTabularChatCitations,
    createTabularCellCheck,
} from "../tabular.citationSupport";

const DOC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CLAUSE = "El plazo del arrendamiento será de doce meses forzosos para ambas partes.";
const RENT = "La renta mensual es de $15,000 pesos, pagadera por adelantado.";
const markdown = [
    `## Source document: a.pdf\nSource document ID: ${DOC}\n\nPrimera. ${CLAUSE}\nSegunda. ${RENT}`,
    `## Source document: b.pdf\nSource document ID: ${OTHER}\n\nTercera. Otra cosa que nadie cita.`,
].join("\n\n---\n\n");

afterEach(() => {
    delete process.env.LITT_CITATION_CHECK;
    delete process.env.TYPESAFE_API_KEY;
});

describe("cellCitationInputs", () => {
    it("takes the cell's sentence as the claim, the cited text as the quote and the paragraph as the context", () => {
        const inputs = cellCitationInputs({
            result: {
                summary: `Doce meses forzosos. [[document:${DOC}||page:1||quote:${CLAUSE}]] Renta de 15 mil pesos. [[document:${DOC}||page:1||quote:renta mensual es de $15,000 pesos]]`,
                flag: "green",
                reasoning: "",
            },
            markdown,
            sourceDocumentIds: [DOC, OTHER],
        });
        expect(inputs.map((i) => i.ref)).toEqual([1, 2]);
        expect(inputs[0].state.afirmacion).toBe("Doce meses forzosos.");
        expect(inputs[0].state.cita).toBe(CLAUSE);
        expect(inputs[1].state.afirmacion).toBe("Renta de 15 mil pesos.");
        // The context is the quote's paragraph, not the whole document.
        expect(inputs[0].state.contexto).toBe(`Primera. ${CLAUSE}`);
        expect(inputs[0].state.contexto).not.toContain("Segunda");
        expect(inputs[0].documentId).toBe(DOC);
        expect(typeof inputs[0].startChar).toBe("number");
        // Only the three fields leave; no name of a document or column.
        expect(Object.keys(inputs[0].state).sort()).toEqual(["afirmacion", "cita", "contexto"]);
        const sent = JSON.stringify(inputs.map((i) => i.state));
        expect(sent).not.toContain("a.pdf");
        expect(sent).not.toContain(DOC);
        expect(sent).not.toContain("[[");
    });

    it("reads the reasoning too, and a tag summary is not a citation", () => {
        const inputs = cellCitationInputs({
            result: {
                summary: "[[Yes]]",
                flag: "green",
                reasoning: `Hay plazo forzoso. [[page:1||quote:${CLAUSE}]]`,
            },
            markdown,
            sourceDocumentIds: [DOC],
        });
        expect(inputs).toHaveLength(1);
        expect(inputs[0].state.afirmacion).toBe("Hay plazo forzoso.");
    });

    it("skips what cannot be checked: a quote not in the document, a document the row lacks, an ambiguous document", () => {
        const result = (marker: string) => ({ summary: `Algo. ${marker}`, flag: "grey" as const, reasoning: "" });
        const run = (marker: string, ids: string[]) =>
            cellCitationInputs({ result: result(marker), markdown, sourceDocumentIds: ids });
        expect(run(`[[document:${DOC}||page:1||quote:texto inventado que no existe en ningún lado]]`, [DOC])).toEqual([]);
        expect(run(`[[document:33333333-3333-4333-8333-333333333333||page:1||quote:${CLAUSE}]]`, [DOC])).toEqual([]);
        expect(run(`[[page:1||quote:${CLAUSE}]]`, [DOC, OTHER])).toEqual([]);
        expect(run(`[[page:1||quote:${CLAUSE}]]`, [DOC])).toHaveLength(1);
    });

    it("caps the citations of one cell", () => {
        const many = Array.from({ length: 40 }, () => `Plazo. [[document:${DOC}||page:1||quote:${CLAUSE}]]`).join(" ");
        expect(cellCitationInputs({ result: { summary: many, flag: "grey", reasoning: "" }, markdown, sourceDocumentIds: [DOC] })).toHaveLength(25);
    });
});

describe("chatCitationInputs", () => {
    const store = {
        columns: [{ index: 0, name: "Plazo" }],
        documents: [{ id: DOC, filename: "contrato.pdf" }],
        cells: new Map([[`0:${DOC}`, { summary: `Doce meses forzosos. [[document:${DOC}||page:1||quote:${CLAUSE}]]`, reasoning: "Lo dice la cláusula primera." }]]),
    } as never;

    it("checks each cited cell text against the sentence that carries its marker", async () => {
        const inputs = await chatCitationInputs({
            fullText: 'El plazo es de doce meses [1]. Otra cosa [2].\n<CITATIONS>[{"ref":1,"col_index":0,"row_index":0,"quote":"Doce meses forzosos."},{"ref":2,"col_index":0,"row_index":0,"quote":"no está en la celda"}]</CITATIONS>',
            annotations: [
                { ref: 1, col_index: 0, row_index: 0, quote: "Doce meses forzosos." },
                { ref: 2, col_index: 0, row_index: 0, quote: "no está en la celda" },
            ],
            store,
        });
        expect(inputs).toHaveLength(1);
        expect(inputs[0].ref).toBe(1);
        expect(inputs[0].state.afirmacion).toBe("El plazo es de doce meses");
        expect(inputs[0].state.cita).toBe("Doce meses forzosos.");
        // The paragraph of the cell, without its citation markers.
        expect(inputs[0].state.contexto).toBe("Doce meses forzosos.");
        expect(inputs[0].documentId).toBeNull();
        const sent = JSON.stringify(inputs[0].state);
        expect(sent).not.toContain("contrato.pdf");
        expect(sent).not.toContain("Plazo\"");
    });

    it("reads COL/ROW as positions, not as the column's own index (which has gaps after a column is deleted)", async () => {
        const gapped = {
            columns: [{ index: 0, name: "Partes" }, { index: 2, name: "Plazo" }, { index: 3, name: "Renta" }],
            documents: [{ id: DOC, filename: "contrato.pdf" }],
            cells: new Map([
                [`0:${DOC}`, { summary: "Arrendador y arrendatario." }],
                [`2:${DOC}`, { summary: "Doce meses forzosos." }],
                [`3:${DOC}`, { summary: "Renta de 15 mil pesos." }],
            ]),
        } as never;
        const run = (col: number, quote: string) =>
            chatCitationInputs({
                fullText: "Dice esto [1].",
                annotations: [{ ref: 1, col_index: col, row_index: 0, quote }],
                store: gapped,
            });
        const plazo = await run(1, "Doce meses forzosos.");
        expect(plazo).toHaveLength(1);
        expect(plazo[0].state.contexto).toBe("Doce meses forzosos.");
        const renta = await run(2, "Renta de 15 mil pesos.");
        expect(renta).toHaveLength(1);
        expect(renta[0].state.contexto).toBe("Renta de 15 mil pesos.");
        expect(await run(3, "Renta de 15 mil pesos.")).toEqual([]);
    });

    it("ignores a citation of a cell that does not exist", async () => {
        const inputs = await chatCitationInputs({
            fullText: "Algo [1].",
            annotations: [{ ref: 1, col_index: 9, row_index: 9, quote: "x" }],
            store,
        });
        expect(inputs).toEqual([]);
    });
});

describe("where the tabular check runs code", () => {
    it("is nothing at all while the server switch or the key is off", () => {
        const db = { from: vi.fn() } as never;
        expect(createTabularCellCheck({ db, userId: "u", reviewId: "r" })).toBeUndefined();
        process.env.LITT_CITATION_CHECK = "enabled";
        expect(createTabularCellCheck({ db, userId: "u", reviewId: "r" })).toBeUndefined();
        checkTabularChatCitations({
            db, userId: "u", orgId: null, messageId: "m", fullText: "x [1]",
            annotations: [{ ref: 1, col_index: 0, row_index: 0, quote: "x" }],
            store: { columns: [], documents: [], cells: new Map() },
        });
        expect((db as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
    });

    it("reads nothing for a person who has not accepted the current terms", async () => {
        process.env.LITT_CITATION_CHECK = "enabled";
        process.env.TYPESAFE_API_KEY = "synthetic-key";
        const tables: string[] = [];
        const deleted: unknown[] = [];
        const db = {
            from: (table: string) => {
                tables.push(table);
                return {
                    delete: () => ({
                        eq: async (column: string, value: unknown) => {
                            deleted.push([column, value]);
                            return { error: null };
                        },
                    }),
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({ data: { citation_check: true, terms_accepted_version: "old" }, error: null }),
                        }),
                    }),
                };
            },
        } as never;
        const check = createTabularCellCheck({ db, userId: "u", reviewId: "r" });
        expect(check).toBeTypeOf("function");
        check!({
            cellId: "c",
            result: { summary: `Plazo. [[document:${DOC}||page:1||quote:${CLAUSE}]]`, flag: "grey", reasoning: "" },
            markdown,
            sourceDocumentIds: [DOC],
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        // The old content's results go; nothing else is read before the permission.
        expect(tables).toEqual(["citation_support_checks", "user_profiles"]);
        expect(deleted).toEqual([["tabular_cell_id", "c"]]);
    });

    it("removes the previous content's results of a cell regenerated with nothing to check", async () => {
        process.env.LITT_CITATION_CHECK = "enabled";
        process.env.TYPESAFE_API_KEY = "synthetic-key";
        const tables: string[] = [];
        const deleted: unknown[] = [];
        const db = {
            from: (table: string) => {
                tables.push(table);
                return {
                    delete: () => ({
                        eq: async (column: string, value: unknown) => {
                            deleted.push([column, value]);
                            return { error: null };
                        },
                    }),
                };
            },
        } as never;
        createTabularCellCheck({ db, userId: "u", reviewId: "r" })!({
            cellId: "c",
            result: { summary: "Sin citas.", flag: "grey", reasoning: "" },
            markdown,
            sourceDocumentIds: [DOC],
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(deleted).toEqual([["tabular_cell_id", "c"]]);
        expect(tables).toEqual(["citation_support_checks"]);
    });
});

describe("citation markers in a long cell", () => {
    const cell = (text: string) => ({ summary: text, flag: "green" as const, reasoning: "" });
    const read = (text: string) => cellCitationInputs({ result: cell(text), markdown, sourceDocumentIds: [DOC] });

    it("reads a cell made of opening brackets in linear time", () => {
        expectLinearCost((n) => read("[[".repeat(n) + "]"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => read("[[a" + "[".repeat(n)), { small: 2_000, large: 64_000 });
    });
    it("cleans each cell of a chat answer in linear time", async () => {
        const annotations = Array.from({ length: 8 }, (_, i) => ({ ref: i + 1, col_index: 0, row_index: 0, quote: "q" }));
        await expectLinearCostAsync(
            (n) => {
                const store = {
                    columns: [{ index: 0 }],
                    documents: [{ id: DOC }],
                    cells: new Map([[`0:${DOC}`, cell("[[".repeat(n) + "]")]]),
                } as unknown as Parameters<typeof chatCitationInputs>[0]["store"];
                return chatCitationInputs({ fullText: "A [1] [2].", annotations, store });
            },
            { small: 2_000, large: 64_000 },
        );
    });
    it("cleans a cell once for however many annotations cite it", async () => {
        let reads = 0;
        const counted = {
            get summary() {
                reads += 1;
                return "The term is ten days [[page:1||quote:ten days]].";
            },
            flag: "green" as const,
            reasoning: "",
        };
        const store = {
            columns: [{ index: 0 }],
            documents: [{ id: DOC }],
            cells: new Map([[`0:${DOC}`, counted]]),
        } as unknown as Parameters<typeof chatCitationInputs>[0]["store"];
        const annotations = Array.from({ length: 12 }, (_, i) => ({ ref: i + 1, col_index: 0, row_index: 0, quote: "q" }));
        await chatCitationInputs({ fullText: "A [1] [2] [3].", annotations, store });
        expect(reads).toBe(1);
    });
    it("skips a cell over the shared bound", () => {
        expect(read(`[[document:${DOC}||page:1||quote:${CLAUSE}]]` + "x".repeat(MODEL_TEXT_MAX_CHARS + 1))).toEqual([]);
    });
});

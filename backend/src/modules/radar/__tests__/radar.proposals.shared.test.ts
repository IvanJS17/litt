import { describe, expect, it } from "vitest";
import { exportFileName, renderProposalsMarkdown, type ExportProposal } from "../radar.proposals.markdown";
import { buildProposeSystemPrompt, MAX_PROPOSALS, parseProposal, planProposals, writesCalendarDate } from "../radar.proposals.shared";

const good = {
    law: "LGSM",
    article: "Art. 181",
    obligation: "Celebrar la asamblea.",
    anchor_name: "Cierre del ejercicio",
    quote: "Una cita",
    page: null,
    plazo_propuesto: "+4 meses",
};

describe("the closed schema of a proposal", () => {
    it("reads an item that fits and keeps a draft term as text", () => {
        expect(parseProposal(good)).toEqual({ law: "LGSM", article: "Art. 181", obligation: "Celebrar la asamblea.", anchorName: "Cierre del ejercicio", quote: "Una cita", page: null, plazoPropuesto: "+4 meses", termHadDate: false });
        expect(parseProposal({ ...good, plazo_propuesto: null })).toMatchObject({ plazoPropuesto: null, termHadDate: false });
        const { plazo_propuesto: _term, ...withoutTerm } = good;
        expect(parseProposal(withoutTerm)).toMatchObject({ plazoPropuesto: null });
        expect(parseProposal({ ...good, page: 12 })).toMatchObject({ page: 12 });
    });

    it.each([
        [{ ...good, fecha: "2027-04-30" }],
        [{ ...good, operation: "+4 months" }],
        [{ ...good, law: "" }],
        [{ ...good, article: 5 }],
        [{ ...good, obligation: "x".repeat(301) }],
        [{ ...good, anchor_name: "x".repeat(121) }],
        [{ ...good, quote: "" }],
        [{ ...good, quote: "x".repeat(501) }],
        [{ ...good, page: 0 }],
        [{ ...good, page: "3" }],
        [{ ...good, plazo_propuesto: "x".repeat(81) }],
        [{ ...good, plazo_propuesto: 4 }],
        [{ ...good, plazo_propuesto: "  " }],
        ["text"],
        [null],
        [[]],
    ])("takes %j out of the schema", (value) => {
        expect(parseProposal(value)).toBeNull();
    });

    it("drops a term that writes a calendar date and keeps the item", () => {
        for (const term of ["a más tardar el 30 de abril", "2027-04-30", "30/04/2027", "en abril", "April 30", "30 apr", "en 2027", "dic 15"]) {
            expect(parseProposal({ ...good, plazo_propuesto: term }), term).toMatchObject({ plazoPropuesto: null, termHadDate: true });
        }
        for (const term of ["+4 meses", "30 días naturales", "dentro de los tres meses siguientes", "−15 días antes", "5 días hábiles"]) {
            expect(writesCalendarDate(term), term).toBe(false);
        }
    });

    it("cleans markup and line breaks from the text fields", () => {
        expect(parseProposal({ ...good, obligation: "Hacer <b>esto</b>\nya" })).toMatchObject({ obligation: "Hacer esto ya" });
    });

    it("keeps at most 25 items and counts the rest and the invalid ones", () => {
        const plan = planProposals([...Array.from({ length: MAX_PROPOSALS }, () => good), good, { ...good, fecha: 1 }]);
        expect(plan.items).toHaveLength(MAX_PROPOSALS);
        expect(plan.invalid).toBe(2);
        expect(planProposals([{ x: 1 }, good])).toMatchObject({ invalid: 1 });
    });
});

describe("the prompt", () => {
    it("holds the closed schema and the codes, and no wording of a rule", () => {
        const prompt = buildProposeSystemPrompt(["a.b", "lft.ptu_reparto"]);
        expect(prompt).toContain("- a.b\n- lft.ptu_reparto");
        expect(prompt).toContain('"plazo_propuesto": string or null');
        expect(prompt).toContain("Never write a calendar date");
        expect(prompt).toContain("any other key makes the item invalid");
        expect(prompt).not.toContain("|");
    });
});

const proposal = (extra: Partial<ExportProposal> = {}, source: Partial<ExportProposal["source"]> = {}): ExportProposal => ({
    id: "11111111-1111-4111-8111-111111111111",
    law: "Ley X",
    article: "Art. 1",
    obligation: "Hacer algo.",
    anchorName: "Un hecho",
    plazoPropuesto: "+4 meses",
    quote: "«cita» con | barra\ny salto  y “comillas” — y guion",
    page: null,
    source: { documentName: "ley.docx", versionNumber: 2, versionId: "v1", textSha256: "a".repeat(64), provider: "claude", model: "m1", ...source },
    ...extra,
});

describe("the file for legal", () => {
    const at = "2026-11-19T18:30:00.000Z";
    it("has legal's columns in order, the header and the legend", () => {
        const md = renderProposalsMarkdown([proposal()], { projectName: "Leyes", exportedAt: at });
        expect(md.split("\n")[0]).toBe("# LiTT · Propuestas de reglas nuevas (borrador para legal)");
        expect(md).toContain("- Exportado: 2026-11-19T18:30:00.000Z");
        expect(md).toContain("- Proyecto: Leyes");
        expect(md).toContain("- Documento: ley.docx");
        expect(md).toContain("- Versión: 2");
        expect(md).toContain(`- text_sha256: \`${"a".repeat(64)}\``);
        expect(md).toContain("- Proveedor y modelo: claude / m1");
        expect(md).toContain("- Número de propuestas: 1");
        expect(md).toContain("> **Borrador sin verificar. No se puede usar hasta que legal lo verifique y se agregue al catálogo. La cita se comprobó solo contra el texto subido, no contra la fuente oficial. El plazo lo propuso la IA y no está verificado.**");
        const header = md.split("\n").find((line) => line.startsWith("| # |"))!;
        expect(header.split("|").slice(1, -1).map((c) => c.trim())).toEqual([
            "#", "id_propuesta", "codigo", "Obligación propuesta (IA)", "Cuándo aplica", "Dato de partida (IA)",
            "Plazo propuesto (borrador, sin verificar)", "Cita literal (texto subido)", "Ley y artículo (según el texto subido)",
            "Pág.", "URL oficial", "Última reforma DOF", "estado", "Notas de legal",
        ]);
        const row = md.split("\n").find((line) => line.startsWith("| 1 |"))!;
        expect(row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())).toEqual([
            "1", "`11111111-1111-4111-8111-111111111111`", "por llenar", "Hacer algo.", "por llenar", "Un hecho", "Sin verificar: +4 meses",
            "**Art. 1:** ««cita» con \\| barra<br>y salto  y “comillas” — y guion»", "Ley X — Art. 1", "—", "por llenar", "por llenar", "propuesta", "por llenar",
        ]);
    });

    it("writes — for a missing term and the page when there is one, and never invents a code or a name", () => {
        const md = renderProposalsMarkdown([proposal({ plazoPropuesto: null, page: 7 })], { projectName: "L", exportedAt: at });
        const row = md.split("\n").find((line) => line.startsWith("| 1 |"))!;
        expect(row).toContain("| — |");
        expect(row).toContain("| 7 |");
        expect(md).not.toContain("verificada");
    });

    it("keeps the quote exactly as stored: quotes, dashes and spacing are not normalized", () => {
        const quote = "“a”  —  ‘b’\u00a0c";
        const md = renderProposalsMarkdown([proposal({ quote })], { projectName: "L", exportedAt: at });
        expect(md).toContain(`«${quote}»`);
    });

    it("groups the tables by text, numbering the rows through", () => {
        const md = renderProposalsMarkdown([proposal(), proposal({ id: "b" }, { versionId: "v2", textSha256: "b".repeat(64), documentName: null, versionNumber: null })], { projectName: "L", exportedAt: at });
        expect(md.match(/^## Texto fuente/gm)).toHaveLength(2);
        expect(md).toContain("| 2 |");
        expect(md).toContain("(sin nombre)");
        expect(renderProposalsMarkdown([], { projectName: "L", exportedAt: at })).toContain("Número de propuestas: 0");
    });

    it("names the file propuestas-reglas-<proyecto>-<AAAAMMDD>.md in safe ASCII", () => {
        expect(exportFileName("Biblioteca legal: Leyes Mexicanas", at)).toBe("propuestas-reglas-biblioteca-legal-leyes-mexicanas-20261119.md");
        expect(exportFileName("Año  ñandú / \"x\"", at)).toBe("propuestas-reglas-ano-nandu-x-20261119.md");
        expect(exportFileName("¿¿??", at)).toBe("propuestas-reglas-proyecto-20261119.md");
    });

    it("dates the file on the Mexico City calendar day, not the UTC one", () => {
        // 21:30 on 19 November in Mexico City is already the 20th in UTC.
        expect(exportFileName("L", "2026-11-20T03:30:00.000Z")).toBe("propuestas-reglas-l-20261119.md");
    });

    it("escapes a backslash so a quoted \\| cannot end the cell early (CodeQL js/incomplete-sanitization)", () => {
        const md = renderProposalsMarkdown([proposal({ quote: "a \\| b \\ c" })], { projectName: "L", exportedAt: at });
        const row = md.split("\n").find((line) => line.startsWith("| 1 |"))!;
        expect(row).toContain("a \\\\\\| b \\\\ c");
        // GFM: a pipe is a column separator unless an odd number of backslashes precede it.
        const separators = [...row.matchAll(/(\\*)\|/g)].filter((m) => m[1].length % 2 === 0);
        expect(separators).toHaveLength(15);
    });
});

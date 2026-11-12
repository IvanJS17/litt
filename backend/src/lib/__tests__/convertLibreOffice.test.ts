// Word → PDF and Markdown → PDF with the real LibreOffice. The rest of the
// suite mocks the converter; this one proves the PDFs are readable. It is
// skipped on a host without LibreOffice (the backend image installs it).

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { docxToPdf } from "../convert";
import { extractPdfMarkdown } from "../extraction/documentMarkdown";
import { markdownToDocx } from "../markdownDocx";
import { buildRichDocx, FIXTURE_TEXT } from "./docxFixtures";

const hasLibreOffice = !!process.env.SOFFICE_BINARY_PATH || spawnSync("soffice", ["--version"]).status === 0;
const text = async (pdf: Buffer) =>
    // pdf.js joins positioned runs with extra spaces; the words are what is compared.
    (await extractPdfMarkdown(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer)).replace(/\s+/g, " ");

describe.skipIf(!hasLibreOffice)("conversions to PDF with LibreOffice", () => {
    it("turns a Markdown file with accents, a table and a list into a PDF with readable text", async () => {
        const pdf = await docxToPdf(
            await markdownToDocx("# Convenio\n\nEl señor Muñoz pagará **mil** pesos.\n\n1. Primero\n2. Segundo\n\n| Concepto | Monto |\n| --- | --- |\n| Asesoría | 1,500 |\n"),
        );
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        const out = await text(pdf);
        for (const piece of ["Convenio", "El señor Muñoz pagará mil pesos.", "Segundo", "Asesoría", "1,500"])
            expect(out, piece).toContain(piece);
    }, 120_000);

    it("turns a Word file into a PDF with its text", async () => {
        const out = await text(await docxToPdf(await buildRichDocx()));
        expect(out).toContain(FIXTURE_TEXT.title);
        expect(out).toContain("Asesoría");
    }, 120_000);
});

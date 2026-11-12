import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import mammoth from "mammoth";
import { markdownToDocx } from "../markdownDocx";
import { docxToMarkdown } from "../docxMarkdown";

const SOURCE = `# Contrato de niños

Texto con **negritas**, *cursiva* y ~~tachado~~; acentos áéíóú, eñes: España, año, señor.

1. Primero
2. Segundo
   - subinciso a
   - subinciso b
3. Tercero

- viñeta uno
- viñeta dos

| Concepto | Monto |
| --- | ---: |
| Asesoría | 1,500 |

> Cita **importante**

\`\`\`
código literal
\`\`\`

---

Fin.
`;

const rawText = async (bytes: Buffer) => (await mammoth.extractRawText({ buffer: bytes })).value;

describe("markdownToDocx", () => {
    it("writes the text of the Markdown, accents and eñes included, as a Word file mammoth reads back", async () => {
        const docx = await markdownToDocx(SOURCE);
        const text = await rawText(docx);
        for (const piece of [
            "Contrato de niños",
            "Texto con negritas, cursiva y tachado; acentos áéíóú, eñes: España, año, señor.",
            "Primero",
            "Segundo",
            "subinciso a",
            "subinciso b",
            "Tercero",
            "viñeta uno",
            "viñeta dos",
            "Concepto",
            "Asesoría",
            "1,500",
            "Cita importante",
            "código literal",
            "Fin.",
        ])
            expect(text, piece).toContain(piece);
        // No Markdown syntax is left in the Word text.
        expect(text).not.toMatch(/\*\*|~~|```|\| ---/);
    });

    it("keeps headings, emphasis, numbered lists and the table as Word structure", async () => {
        const back = await docxToMarkdown(await markdownToDocx(SOURCE));
        expect(back).toContain("# Contrato de niños");
        expect(back).toContain("**negritas**");
        expect(back).toContain("*cursiva*");
        expect(back).toMatch(/1\.\s+Primero\n2\.\s+Segundo/);
        expect(back).toMatch(/3\.\s+Tercero/);
        expect(back).toContain("| Asesoría | 1,500 |");
    });

    it("restarts the numbering of a second numbered list", async () => {
        const back = await docxToMarkdown(await markdownToDocx("1. uno\n2. dos\n\ntexto\n\n1. otra\n2. más\n"));
        expect(back).toMatch(/1\.\s+uno\n2\.\s+dos\n\ntexto\n\n1\.\s+otra\n2\.\s+más/);
    });

    it("uses the house style: Times New Roman 11", async () => {
        const zip = await JSZip.loadAsync(await markdownToDocx("hola"));
        const styles = await zip.file("word/styles.xml")!.async("string");
        expect(styles).toContain("Times New Roman");
        expect(styles).toMatch(/<w:sz w:val="22"\/>/);
    });

    it("ignores raw HTML and drops links that are not http(s) or mailto", async () => {
        const docx = await markdownToDocx(
            [
                "antes <b>negrita html</b> después",
                "",
                "<script>alert(1)</script>",
                "",
                '<div onclick="x()">bloque html</div>',
                "",
                "[bien](https://example.com/a) [correo](mailto:a@b.mx) [mal](javascript:alert(1)) [dato](data:text/html,x)",
            ].join("\n"),
        );
        const text = await rawText(docx);
        expect(text).not.toContain("alert(1)");
        expect(text).not.toContain("bloque html");
        expect(text).not.toContain("<b>");
        for (const kept of ["bien", "correo", "mal", "dato"]) expect(text).toContain(kept);

        const zip = await JSZip.loadAsync(docx);
        const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
        expect(rels).toContain("https://example.com/a");
        expect(rels).toContain("mailto:a@b.mx");
        expect(rels).not.toMatch(/javascript:|data:text/i);
        const body = await zip.file("word/document.xml")!.async("string");
        expect(body).not.toMatch(/javascript:|<script|onclick/i);
    });

    it("writes a picture's description instead of embedding it, and survives an empty document", async () => {
        expect(await rawText(await markdownToDocx("![logo del despacho](https://example.com/x.png)"))).toContain(
            "logo del despacho",
        );
        expect((await rawText(await markdownToDocx(""))).trim()).toBe("");
        expect(await rawText(await markdownToDocx("\uFEFFcon BOM"))).toContain("con BOM");
    });

    it("keeps a hard break and nested emphasis", async () => {
        const text = await rawText(await markdownToDocx("línea uno  \nlínea dos y ***ambas***"));
        expect(text).toContain("línea uno");
        expect(text).toContain("línea dos y ambas");
    });
});

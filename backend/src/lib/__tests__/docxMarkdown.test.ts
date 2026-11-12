import { describe, expect, it } from "vitest";
import { docxToMarkdown, IMAGE_PLACEHOLDER } from "../docxMarkdown";
import { buildRichDocx, FIXTURE_TEXT } from "./docxFixtures";

describe("docxToMarkdown on a synthetic Word file", () => {
    it("keeps the text, writes the table as GFM and says what it dropped", async () => {
        const md = await docxToMarkdown(await buildRichDocx());

        expect(md).toContain(`# ${FIXTURE_TEXT.title}`);
        expect(md).toContain(`**${FIXTURE_TEXT.clause}**`);
        // The final text of a tracked change stays; the deleted side does not.
        expect(md).toContain(`Antes. ${FIXTURE_TEXT.inserted} Después.`);
        expect(md).not.toContain(FIXTURE_TEXT.deleted);
        // A table with a header row, not raw HTML.
        expect(md).toContain("| Concepto | Monto |\n| --- | --- |\n| Asesoría | 1,500 |");
        expect(md).not.toMatch(/<\/?(table|tr|td|th)\b/i);
        // The picture is a marker, not data.
        expect(md).toContain(IMAGE_PLACEHOLDER);
        expect(md).not.toContain("base64");
        // Footnotes end as a list; comments, headers and footers do not pass.
        expect(md).toMatch(/\n1\.\s+Nota al pie de ejemplo\.$/);
        expect(md).not.toContain(FIXTURE_TEXT.commentBody);
        expect(md).not.toContain(FIXTURE_TEXT.header);
        expect(md).not.toContain(FIXTURE_TEXT.footer);
        // No back-link arrow from the footnote.
        expect(md).not.toContain("↑");
    });

    it("accepts a Buffer or an ArrayBuffer and rejects a file that is not a Word file", async () => {
        const buffer = await buildRichDocx();
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        expect(await docxToMarkdown(arrayBuffer)).toBe(await docxToMarkdown(buffer));
        await expect(docxToMarkdown(Buffer.from("not a zip"))).rejects.toThrow();
    });
});

describe("docxToMarkdown escaping", () => {
    // The document's own words that look like markup stay words: turndown
    // escapes backslashes and Markdown characters, then "<" is escaped too, so
    // a backslash before "<" can never cancel that escape (CodeQL alert 78).
    it("escapes backslashes before the bracket so text never becomes a tag", async () => {
        const { Document, Packer, Paragraph } = await import("docx");
        const doc = new Document({ sections: [{ children: [new Paragraph("a\\b \\<b>bold\\</b> <i>")] }] });
        const markdown = await docxToMarkdown(await Packer.toBuffer(doc));
        expect(markdown).toBe("a\\\\b \\\\\\<b>bold\\\\\\</b> \\<i>");
    });
});

// Synthetic Word files for the conversion tests. Nothing here is a real
// document: every name, clause and amount is invented.

import {
    Document,
    Footer,
    FootnoteReferenceRun,
    Header,
    ImageRun,
    InsertedTextRun,
    DeletedTextRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    HeadingLevel,
    CommentRangeStart,
    CommentRangeEnd,
    CommentReference,
} from "docx";

/** A 1x1 transparent PNG. */
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
);

export const FIXTURE_TEXT = {
    title: "Contrato de prestación de servicios",
    clause: "El señor Muñoz pagará la cantidad de $1,500.00 por concepto de asesoría.",
    inserted: "texto insertado",
    deleted: "texto eliminado",
    commentBody: "revisar con el cliente",
    footnote: "Nota al pie de ejemplo.",
    header: "ENCABEZADO CONFIDENCIAL",
    footer: "PIE DE PÁGINA 1",
};

/** A Word file with a heading, a table, a comment, w:ins/w:del, a picture, a footnote, a header and a footer. */
export async function buildRichDocx(): Promise<Buffer> {
    const doc = new Document({
        comments: {
            children: [
                {
                    id: 0,
                    author: "Revisor Sintético",
                    date: new Date("2026-01-01T00:00:00Z"),
                    children: [new Paragraph({ children: [new TextRun(FIXTURE_TEXT.commentBody)] })],
                },
            ],
        },
        footnotes: {
            1: { children: [new Paragraph({ children: [new TextRun(FIXTURE_TEXT.footnote)] })] },
        },
        sections: [
            {
                headers: {
                    default: new Header({ children: [new Paragraph(FIXTURE_TEXT.header)] }),
                },
                footers: {
                    default: new Footer({ children: [new Paragraph(FIXTURE_TEXT.footer)] }),
                },
                children: [
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(FIXTURE_TEXT.title)] }),
                    new Paragraph({
                        children: [
                            new CommentRangeStart(0),
                            new TextRun({ text: FIXTURE_TEXT.clause, bold: true }),
                            new CommentRangeEnd(0),
                            new TextRun({ children: [new CommentReference(0)] }),
                            new FootnoteReferenceRun(1),
                        ],
                    }),
                    new Paragraph({
                        children: [
                            new TextRun("Antes. "),
                            new InsertedTextRun({
                                id: 1,
                                author: "Revisor Sintético",
                                date: "2026-01-02T00:00:00Z",
                                text: FIXTURE_TEXT.inserted,
                            }),
                            new DeletedTextRun({
                                id: 2,
                                author: "Revisor Sintético",
                                date: "2026-01-02T00:00:00Z",
                                text: FIXTURE_TEXT.deleted,
                            }),
                            new TextRun(" Después."),
                        ],
                    }),
                    new Table({
                        rows: [
                            new TableRow({
                                children: ["Concepto", "Monto"].map(
                                    (text) => new TableCell({ children: [new Paragraph(text)] }),
                                ),
                            }),
                            new TableRow({
                                children: ["Asesoría", "1,500"].map(
                                    (text) => new TableCell({ children: [new Paragraph(text)] }),
                                ),
                            }),
                        ],
                    }),
                    new Paragraph({
                        children: [
                            new ImageRun({
                                type: "png",
                                data: PNG,
                                transformation: { width: 10, height: 10 },
                                altText: { name: "logo", description: "logo", title: "logo" },
                            }),
                        ],
                    }),
                ],
            },
        ],
    });
    return Packer.toBuffer(doc);
}

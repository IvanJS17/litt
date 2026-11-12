// Synthetic .docx files for the round-trip check. No client content.
import {
    AlignmentType, CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document,
    Footer, Header, InsertedTextRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow,
    TextRun, WidthType,
} from "docx";

const DATE = "2026-09-23T00:00:00Z";
const AUTHOR = "Revisora";
const numbering = {
    config: [{
        reference: "clausulas",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }],
    }],
};
const cell = (text: string) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph(text)] });
const table = (rows: string[][]) => new Table({
    width: { size: 9000, type: WidthType.DXA }, columnWidths: [3000, 3000, 3000],
    rows: rows.map((r) => new TableRow({ children: r.map(cell) })),
});
const item = (text: string) => new Paragraph({ text, numbering: { reference: "clausulas", level: 0 } });
const header = () => ({ default: new Header({ children: [new Paragraph("ENCABEZADO — Contrato de prestación de servicios")] }) });
const footer = () => ({ default: new Footer({ children: [new Paragraph("Pie: página única — Señalética")] }) });

export type Fixture = {
    name: string;
    /** A word present once in the body that the edit step replaces. */
    editFind: string;
    editWith: string;
    build(): Promise<Buffer>;
};

export const FIXTURES: Fixture[] = [
    {
        name: "tabla-y-lista",
        editFind: "alfa",
        editWith: "beta",
        build: () => Packer.toBuffer(new Document({
            numbering,
            sections: [{
                headers: header(), footers: footer(),
                children: [
                    new Paragraph({ children: [new TextRun({ text: "Cláusulas del año — ", bold: true }), new TextRun({ text: "ñandú, pingüino, acción", italics: true })] }),
                    item("Primera obligación: alfa"),
                    item("Segunda obligación"),
                    item("Tercera obligación"),
                    table([["Concepto", "Monto", "Plazo"], ["Revisión", "$100", "30 días"], ["Corrección", "$250", "15 días"], ["Total", "$350", "—"]]),
                    new Paragraph("Fin del documento."),
                ],
            }],
        })),
    },
    {
        name: "comentario",
        editFind: "alfa",
        editWith: "beta",
        build: () => Packer.toBuffer(new Document({
            comments: { children: [{ id: 0, author: AUTHOR, date: new Date(DATE), children: [new Paragraph("Revisar la cláusula de confidencialidad, por favor.")] }] },
            sections: [{
                headers: header(), footers: footer(),
                children: [
                    new Paragraph({ children: [
                        new TextRun("La parte "),
                        new CommentRangeStart(0),
                        new TextRun({ text: "receptora", bold: true }),
                        new CommentRangeEnd(0),
                        new TextRun({ children: [new CommentReference(0)] }),
                        new TextRun(" protegerá la información. Texto editable: alfa."),
                    ] }),
                    new Paragraph({ children: [new TextRun({ text: "Año nuevo, compañía, niño.", italics: true, bold: true })] }),
                ],
            }],
        })),
    },
    {
        name: "control-de-cambios",
        editFind: "alfa",
        editWith: "beta",
        build: () => Packer.toBuffer(new Document({
            sections: [{
                headers: header(), footers: footer(),
                children: [
                    new Paragraph({ children: [
                        new TextRun("El plazo de aviso es de "),
                        new DeletedTextRun({ text: "treinta", id: 101, author: AUTHOR, date: DATE }),
                        new InsertedTextRun({ text: "sesenta", id: 102, author: AUTHOR, date: DATE }),
                        new TextRun(" días naturales."),
                    ] }),
                    new Paragraph({ children: [
                        new InsertedTextRun({ text: "Cláusula añadida sobre jurisdicción.", id: 103, author: AUTHOR, date: DATE }),
                    ] }),
                    new Paragraph("Texto editable: alfa."),
                ],
            }],
        })),
    },
    {
        name: "todo-junto",
        editFind: "alfa",
        editWith: "beta",
        build: () => Packer.toBuffer(new Document({
            numbering,
            comments: { children: [{ id: 0, author: AUTHOR, date: new Date(DATE), children: [new Paragraph("Comentario en tabla y lista.")] }] },
            sections: [{
                headers: header(), footers: footer(),
                children: [
                    new Paragraph({ children: [new TextRun({ text: "Convenio ", bold: true }), new TextRun({ text: "señorial", italics: true }), new TextRun(" — ñ á é í ó ú ü")] }),
                    item("Obligación uno"),
                    item("Obligación dos: alfa"),
                    new Paragraph({ children: [
                        new CommentRangeStart(0), new TextRun("Monto acordado"), new CommentRangeEnd(0),
                        new TextRun({ children: [new CommentReference(0)] }),
                        new TextRun(": "),
                        new DeletedTextRun({ text: "mil", id: 201, author: AUTHOR, date: DATE }),
                        new InsertedTextRun({ text: "dos mil", id: 202, author: AUTHOR, date: DATE }),
                        new TextRun(" pesos."),
                    ] }),
                    table([["A", "B", "C"], ["1", "2", "3"]]),
                ],
            }],
        })),
    },
];

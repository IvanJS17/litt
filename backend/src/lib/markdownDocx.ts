// Markdown → Word. `marked` reads the Markdown into tokens and `docx` writes
// the file, in LiTT's house style (Times New Roman 11), not a user template.
//
// Safety: raw HTML in the Markdown is ignored (its tags and content are not
// written), and a link whose address is not http(s) or mailto keeps its text
// and loses the link. Formulas and footnotes have no Word form here and stay
// as the plain text they were typed as.

import type { Token, Tokens } from "marked" with { "resolution-mode": "import" };
import {
    AlignmentType,
    BorderStyle,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    LevelFormat,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    type ParagraphChild,
} from "docx";

const FONT = "Times New Roman";
const SIZE = 22; // 11 pt, in half-points
const MAX_LIST_DEPTH = 5;
const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;

const HEADINGS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
] as const;

type Marks = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };
type Block = Paragraph | Table;

function run(text: string, marks: Marks): TextRun {
    return new TextRun({
        text,
        font: marks.code ? "Courier New" : FONT,
        size: SIZE,
        bold: marks.bold,
        italics: marks.italics,
        strike: marks.strike,
    });
}

/** The inline tokens of a paragraph, heading, list item or table cell. */
function inlineRuns(tokens: Token[] | undefined, marks: Marks = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const token of tokens ?? []) {
        switch (token.type) {
            case "strong":
                out.push(...inlineRuns((token as Tokens.Strong).tokens, { ...marks, bold: true }));
                break;
            case "em":
                out.push(...inlineRuns((token as Tokens.Em).tokens, { ...marks, italics: true }));
                break;
            case "del":
                out.push(...inlineRuns((token as Tokens.Del).tokens, { ...marks, strike: true }));
                break;
            case "codespan":
                out.push(run((token as Tokens.Codespan).text, { ...marks, code: true }));
                break;
            case "br":
                out.push(new TextRun({ break: 1 }));
                break;
            case "link": {
                const link = token as Tokens.Link;
                const children = inlineRuns(link.tokens, marks);
                if (SAFE_URL.test(link.href.trim())) {
                    out.push(new ExternalHyperlink({ link: link.href.trim(), children: children as TextRun[] }));
                } else {
                    out.push(...children);
                }
                break;
            }
            case "image":
                // A picture is not embedded: its description stays.
                out.push(run((token as Tokens.Image).text || "[imagen]", marks));
                break;
            case "html":
                break;
            case "text":
            case "escape": {
                const text = token as Tokens.Text;
                if (text.tokens?.length) out.push(...inlineRuns(text.tokens, marks));
                else out.push(run(text.text, marks));
                break;
            }
            default:
                if ("text" in token && typeof token.text === "string") out.push(run(token.text, marks));
        }
    }
    return out;
}

type Numbering = { references: string[] };

function list(token: Tokens.List, depth: number, numbering: Numbering, listId: { next: number }): Block[] {
    const reference = token.ordered ? `ol-${listId.next++}` : null;
    if (reference) numbering.references.push(reference);
    const level = Math.min(depth, MAX_LIST_DEPTH - 1);
    const blocks: Block[] = [];
    for (const item of token.items) {
        let first = true;
        for (const child of item.tokens) {
            if (child.type === "list") {
                blocks.push(...list(child as Tokens.List, depth + 1, numbering, listId));
            } else if (child.type === "text" || child.type === "paragraph") {
                const inline = (child as Tokens.Text).tokens;
                blocks.push(
                    new Paragraph({
                        ...(first
                            ? reference
                                ? { numbering: { reference, level } }
                                : { bullet: { level } }
                            : { indent: { left: 720 * (level + 1) } }),
                        spacing: { after: 80 },
                        children: inlineRuns(inline?.length ? inline : [child]),
                    }),
                );
                first = false;
            } else {
                blocks.push(...block(child, depth + 1, numbering, listId));
            }
        }
    }
    return blocks;
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };

function table(token: Tokens.Table): Table {
    const cell = (c: Tokens.TableCell, header: boolean, align: "left" | "right" | "center" | null) =>
        new TableCell({
            borders: CELL_BORDERS,
            shading: header ? { type: ShadingType.CLEAR, fill: "F2F2F2" } : undefined,
            children: [
                new Paragraph({
                    alignment:
                        align === "center" ? AlignmentType.CENTER : align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
                    children: inlineRuns(c.tokens, header ? { bold: true } : {}),
                }),
            ],
        });
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                tableHeader: true,
                children: token.header.map((c, i) => cell(c, true, token.align[i] ?? null)),
            }),
            ...token.rows.map(
                (row) => new TableRow({ children: row.map((c, i) => cell(c, false, token.align[i] ?? null)) }),
            ),
        ],
    });
}

function block(token: Token, depth: number, numbering: Numbering, listId: { next: number }): Block[] {
    switch (token.type) {
        case "heading": {
            const heading = token as Tokens.Heading;
            return [
                new Paragraph({
                    heading: HEADINGS[Math.min(heading.depth, 6) - 1],
                    spacing: { before: 120, after: 160 },
                    children: inlineRuns(heading.tokens),
                }),
            ];
        }
        case "paragraph":
            return [new Paragraph({ spacing: { after: 120 }, children: inlineRuns((token as Tokens.Paragraph).tokens) })];
        case "text": {
            const text = token as Tokens.Text;
            return [new Paragraph({ spacing: { after: 120 }, children: inlineRuns(text.tokens ?? [token]) })];
        }
        case "list":
            return list(token as Tokens.List, depth, numbering, listId);
        case "table":
            return [table(token as Tokens.Table), new Paragraph({ children: [] })];
        case "blockquote":
            return (token as Tokens.Blockquote).tokens.flatMap((inner) =>
                inner.type === "paragraph"
                    ? [
                          new Paragraph({
                              indent: { left: 720 },
                              spacing: { after: 120 },
                              children: inlineRuns((inner as Tokens.Paragraph).tokens, { italics: true }),
                          }),
                      ]
                    : block(inner, depth, numbering, listId),
            );
        case "code":
            return (token as Tokens.Code).text
                .split("\n")
                .map(
                    (line) =>
                        new Paragraph({
                            spacing: { after: 0 },
                            indent: { left: 360 },
                            children: [run(line, { code: true })],
                        }),
                );
        case "hr":
            return [
                new Paragraph({
                    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
                    children: [],
                }),
            ];
        default:
            // space, html and anything else without a Word form.
            return [];
    }
}

/** Convert Markdown text to the bytes of a .docx. */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
    const numbering: Numbering = { references: [] };
    const listId = { next: 0 };
    // marked is ESM-only; the backend is CommonJS, so it loads on demand.
    const { Lexer } = await import("marked");
    const tokens = new Lexer({ gfm: true }).lex(markdown.replace(/^\uFEFF/, ""));
    const children = tokens.flatMap((token) => block(token, 0, numbering, listId));
    // Word needs at least one paragraph in the body.
    if (children.length === 0) children.push(new Paragraph({ children: [] }));

    const levelFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
    const doc = new Document({
        styles: {
            default: { document: { run: { font: FONT, size: SIZE } } },
            // Headings keep the house face (black, bold, Times) instead of Word's blue theme.
            paragraphStyles: HEADINGS.map((_, i) => ({
                id: `Heading${i + 1}`,
                name: `heading ${i + 1}`,
                basedOn: "Normal",
                next: "Normal",
                quickFormat: true,
                run: { font: FONT, bold: true, color: "000000", size: SIZE + Math.max(0, 6 - i) * 2 },
            })),
        },
        numbering: {
            config: numbering.references.map((reference) => ({
                reference,
                levels: Array.from({ length: MAX_LIST_DEPTH }, (_, level) => ({
                    level,
                    format: levelFormats[level % levelFormats.length],
                    text: `%${level + 1}.`,
                    alignment: AlignmentType.START,
                    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
                })),
            })),
        },
        sections: [{ children }],
    });
    return Packer.toBuffer(doc);
}

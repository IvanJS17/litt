// Reads the parts of a .docx that the round-trip must preserve.
import JSZip from "jszip";

export type DocxSummary = {
    bodyText: string[];
    deletedText: string[];
    headerText: string[];
    footerText: string[];
    tables: number;
    rows: number;
    cells: number;
    numberedParagraphs: number;
    numIds: string[];
    commentCount: number;
    commentText: string[];
    commentRanges: number;
    ins: number;
    del: number;
    insText: string[];
    boldRuns: number;
    italicRuns: number;
};

const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const textOf = (xml: string, tag: string) =>
    [...xml.matchAll(new RegExp(`<w:${tag}(?: [^>]*)?>([^<]*)</w:${tag}>`, "g"))].map((m) => decode(m[1]));
/** Paragraph by paragraph, the concatenated w:t text (w:delText excluded). */
const paragraphs = (xml: string) =>
    [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => textOf(p[0], "t").join("")).filter((t) => t !== "");

async function parts(bytes: Uint8Array, re: RegExp) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((n) => re.test(n)).sort();
    return Promise.all(names.map((n) => zip.file(n)!.async("string")));
}

export async function summarize(bytes: Uint8Array): Promise<DocxSummary> {
    const zip = await JSZip.loadAsync(bytes);
    const body = await zip.file("word/document.xml")!.async("string");
    const comments = (await zip.file("word/comments.xml")?.async("string")) ?? "";
    const headers = await parts(bytes, /^word\/header\d*\.xml$/);
    const footers = await parts(bytes, /^word\/footer\d*\.xml$/);
    return {
        bodyText: paragraphs(body),
        deletedText: textOf(body, "delText"),
        headerText: headers.flatMap(paragraphs),
        footerText: footers.flatMap(paragraphs),
        tables: count(body, /<w:tbl>/g),
        rows: count(body, /<w:tr[ >]/g),
        cells: count(body, /<w:tc>/g),
        numberedParagraphs: count(body, /<w:numPr>/g),
        numIds: [...new Set([...body.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1]))].sort(),
        commentCount: count(comments, /<w:comment /g),
        commentText: [...comments.matchAll(/<w:comment [\s\S]*?<\/w:comment>/g)].map((c) => textOf(c[0], "t").join("")),
        commentRanges: count(body, /<w:commentRangeStart /g),
        ins: count(body, /<w:ins /g),
        del: count(body, /<w:del /g),
        insText: [...body.matchAll(/<w:ins [\s\S]*?<\/w:ins>/g)].map((m) => textOf(m[0], "t").join("")),
        boldRuns: count(body, /<w:b(?: w:val="(?:1|true)")?\/>/g),
        italicRuns: count(body, /<w:i(?: w:val="(?:1|true)")?\/>/g),
    };
}

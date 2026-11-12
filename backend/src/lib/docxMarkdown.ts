// The one Word → Markdown converter: mammoth reads the .docx into HTML and
// turndown (+ GFM tables) writes Markdown. It serves the person's "Convert to
// Markdown" and the text extraction behind tabular review and the assistant,
// so there is no second, hand-written conversion to drift from this one.
//
// Parser-only imports: the extraction worker loads this module.

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { normalizeDocxZipPaths } from "./convert";

/** What replaces a picture: Markdown here carries text, not embedded images. */
export const IMAGE_PLACEHOLDER = "[imagen]";

const SAFE_LINK = /^(?:https?:|mailto:|#)/i;

type DomNode = {
    nodeName: string;
    parentNode: DomNode | null;
    nextSibling: unknown;
    ownerDocument: { createElement(name: string): DomNode };
    childNodes: ArrayLike<DomNode> & Iterable<DomNode>;
    firstChild: DomNode | null;
    rows?: ArrayLike<DomNode>;
    getAttribute(name: string): string | null;
    replaceChild(next: DomNode, old: DomNode): void;
    appendChild(child: DomNode): void;
};

/**
 * mammoth writes a table as `<table><tr><td>…`; GFM needs a header row, and
 * without one turndown keeps the raw HTML (which Markdown viewers ignore, so
 * the table would vanish). The first row becomes the header. It runs from a
 * rule filter because that is the one hook that sees every table node before
 * the GFM table rule decides; it never matches, so the real rule still runs.
 */
function promoteFirstRowToHeader(node: DomNode): false {
    if (node.nodeName !== "TABLE") return false;
    const firstRow = node.rows?.[0];
    if (!firstRow) return false;
    for (const cell of Array.from(firstRow.childNodes)) {
        if (cell.nodeName !== "TD") continue;
        const header = cell.ownerDocument.createElement("th");
        while (cell.firstChild) header.appendChild(cell.firstChild);
        firstRow.replaceChild(header, cell);
    }
    return false;
}

function createService(): TurndownService {
    const service = new TurndownService({
        headingStyle: "atx",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
        strongDelimiter: "**",
        // Raw HTML never reaches the output: whatever has no Markdown form
        // keeps its text and loses its tags.
        blankReplacement: (_content, node) =>
            (node as unknown as { isBlock: boolean }).isBlock ? "\n\n" : "",
    });
    service.use(gfm);
    // Text that reads "<b>" is the document's own words, not markup: escape the
    // bracket so no viewer can take it for a tag.
    const escapeMarkdown = service.escape.bind(service);
    service.escape = (text) => escapeMarkdown(text).replace(/</g, "\\<");
    service.remove(["script", "style"]);
    // A turndown "keep" would copy the tag through as HTML. Nothing is kept.
    service.addRule("mammothTableHeader", {
        filter: (node) => promoteFirstRowToHeader(node as unknown as DomNode),
        replacement: (content) => content,
    });
    // A paragraph inside a table cell must not break the row.
    service.addRule("tableCellParagraph", {
        filter: (node) => {
            const dom = node as unknown as DomNode;
            return (
                dom.nodeName === "P" &&
                (dom.parentNode?.nodeName === "TD" || dom.parentNode?.nodeName === "TH")
            );
        },
        replacement: (content, node) =>
            (node as unknown as DomNode).nextSibling ? `${content.trim()} ` : content.trim(),
    });
    service.addRule("imagePlaceholder", {
        filter: "img",
        replacement: () => IMAGE_PLACEHOLDER,
    });
    // Footnotes: mammoth links "[1]" to the note and the note back with "↑".
    // The reference stays as a plain marker, the note's back-link goes.
    service.addRule("footnoteBackLink", {
        filter: (node) =>
            node.nodeName === "A" &&
            /^#footnote-ref-/.test((node as unknown as DomNode).getAttribute("href") ?? ""),
        replacement: () => "",
    });
    service.addRule("footnoteReference", {
        filter: (node) =>
            node.nodeName === "A" &&
            /^#footnote-\d+$/.test((node as unknown as DomNode).getAttribute("href") ?? ""),
        replacement: (content) => content.replace(/\\([[\]])/g, "$1"),
    });
    // Only web and mail links survive; `javascript:` and the like keep their text.
    service.addRule("safeLink", {
        filter: (node) =>
            node.nodeName === "A" &&
            !SAFE_LINK.test((node as unknown as DomNode).getAttribute("href") ?? ""),
        replacement: (content) => content,
    });
    return service;
}

/**
 * Convert a .docx to Markdown. Throws when the file cannot be read; callers
 * decide whether that is an error (a conversion) or an empty text (extraction).
 *
 * What does not survive: comments, the deleted side of tracked changes (the
 * final text stays), headers and footers, fine formatting, legal numbering
 * (it becomes a plain list) and pictures ("[imagen]").
 */
export async function docxToMarkdown(buf: ArrayBuffer | Buffer): Promise<string> {
    const mammoth = await import("mammoth");
    const normalized = await normalizeDocxZipPaths(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    const { value: html } = await mammoth.convertToHtml(
        { buffer: normalized },
        {
            // The picture's bytes are never read: only its place is kept.
            convertImage: mammoth.images.imgElement(async () => ({ src: "image" })),
        },
    );
    return createService()
        .turndown(html)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

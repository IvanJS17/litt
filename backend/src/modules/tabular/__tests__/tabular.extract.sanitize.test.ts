// The DOCX→Markdown path (lib/docxMarkdown: mammoth → turndown) is what tabular
// review and the assistant read. Two properties matter for sanitization
// (both flagged by CodeQL on the old regex version): the output must not carry
// a live tag assembled from the document's text, and entities must be decoded
// exactly once so already-escaped text is not unescaped into markup.

import { describe, it, expect, vi } from "vitest";

let mammothHtml = "";
vi.mock("mammoth", () => {
    const convertToHtml = async () => ({ value: mammothHtml });
    return {
        default: { convertToHtml },
        convertToHtml,
        images: { imgElement: () => () => undefined },
    };
});
vi.mock("../../../lib/convert", () => ({
    normalizeDocxZipPaths: async (buf: Buffer) => buf,
    docxToPdf: async (buf: Buffer) => buf,
}));

import { extractDocxMarkdown } from "../tabular.extract";

async function markdownFor(html: string): Promise<string> {
    mammothHtml = html;
    return extractDocxMarkdown(new ArrayBuffer(4));
}

describe("extractDocxMarkdown sanitization", () => {
    it("drops scripts and never leaves a live tag in the text", async () => {
        const out = await markdownFor("<p>safe</p><script>alert(1)</script><p>text &lt;script&gt;x&lt;/script&gt;</p>");
        expect(out).not.toContain("alert(1)<");
        expect(out).not.toMatch(/(^|[^\\])<script/);
        expect(out).toContain("safe");
        expect(out).toContain("text");
    });

    it("does not double-unescape &amp;-escaped entities", async () => {
        // "&amp;lt;b&amp;gt;" is the ESCAPED text "&lt;b&gt;" — after one
        // correct decode it must read as literal "&lt;b&gt;", not "<b>".
        const out = await markdownFor("<p>&amp;lt;b&amp;gt;</p>");
        expect(out).toBe("&lt;b&gt;");
    });

    it("still decodes plain entities once", async () => {
        const out = await markdownFor("<p>a &lt;tag&gt; &amp; more&nbsp;here</p>");
        expect(out).toBe("a \\<tag> & more\u00a0here");
    });
});

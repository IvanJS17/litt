import { expect, it, vi } from "vitest";

const html = vi.hoisted(() => ({ value: "", fail: false }));
vi.mock("mammoth", () => ({
  convertToHtml: async () => {
    if (html.fail) throw new Error("unreadable");
    return { value: html.value };
  },
  images: { imgElement: () => () => undefined },
}));
vi.mock("../../convert", () => ({
  docxToPdf: vi.fn(),
  normalizeDocxZipPaths: async (buf: Buffer) => buf,
}));
import { extractDocumentMarkdown, extractDocxMarkdown } from "../documentMarkdown";
import { EXTRACTION_OPS } from "../ops";

const docx = (value: string) => {
  html.value = value;
  return extractDocxMarkdown(new ArrayBuffer(0));
};

it("writes the document's own words, never its markup", async () => {
  expect(await docx("<p>Hello <em>world</em></p>")).toBe("Hello *world*");
  // Escaped by mammoth, so the text is a literal "<b>": the bracket is escaped, not left as a tag.
  expect(await docx("<p>a &lt;b&gt;x&lt;/b&gt; &amp;lt;</p>")).toBe("a \\<b>x\\</b> &lt;");
  // A script is dropped with its content; a style too.
  expect(await docx("<p>keep</p><script>alert(1)</script><style>p{}</style>")).toBe("keep");
});

it("drops links that are not web or mail, keeping their text", async () => {
  expect(await docx('<p><a href="javascript:alert(1)">click</a></p>')).toBe("click");
  expect(await docx('<p><a href="https://example.com/a">site</a> <a href="mailto:a@b.mx">mail</a></p>')).toBe(
    "[site](https://example.com/a) [mail](mailto:a@b.mx)",
  );
});

it("converts a crafted run of brackets in linear time", async () => {
  const started = performance.now();
  const out = await docx(`<p>${"&lt;".repeat(60_000)}tail</p>`);
  const elapsed = performance.now() - started;
  expect(out.endsWith("tail")).toBe(true);
  expect(elapsed).toBeLessThan(5_000);
});

it("returns an empty text for a file it cannot read", async () => {
  html.fail = true;
  try {
    expect(await docx("<p>x</p>")).toBe("");
  } finally {
    html.fail = false;
  }
});

it("reads a Markdown file as exactly its text, for tabular review and read_document", async () => {
  const source = "\uFEFF# Título\n\n<b>no tags stripped</b> &amp; ñ 😀\n";
  const raw = new TextEncoder().encode(source).buffer as ArrayBuffer;
  expect(await extractDocumentMarkdown(raw, "md")).toBe(source);
  expect(await extractDocumentMarkdown(raw, "MD")).toBe(source);
  expect(await EXTRACTION_OPS.markdownText(raw)).toBe(source);
  expect(await EXTRACTION_OPS.documentMarkdown(raw, "md")).toBe(source);
  expect(await EXTRACTION_OPS.documentText(raw, "md")).toEqual({ text: source, textlessPageCount: null });
});

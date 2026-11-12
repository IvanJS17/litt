import { expect, it, vi } from "vitest";

// Three pages: 1 has a text layer, 2 and 3 are scans.
const pageTexts = ["Texto propio", "", ""];
vi.mock("../../pdfjs", () => ({
  loadPdfjs: async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageTexts.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({ items: pageTexts[n - 1] ? [{ str: pageTexts[n - 1] }] : [] }),
        }),
      }),
    }),
  }),
}));
vi.mock("../../convert", () => ({ docxToPdf: vi.fn(), normalizeDocxZipPaths: async (b: Buffer) => b }));
import { extractPdfMarkdown } from "../documentMarkdown";

const reading = (parts: string[], failedPages: number[] = []) => ({
  pages: parts.map((text, index) => ({ page: index + 1, text })),
  failedPages,
});

it("gives pages without a text layer the text of a saved scan reading", async () => {
  const md = await extractPdfMarkdown(new ArrayBuffer(0), reading(["ignorado", "dos", "tres"]));
  expect(md).toBe("## Page 1\n\nTexto propio\n\n## Page 2\n\ndos\n\n## Page 3\n\ntres");
});

it("skips a page the reading failed on and is unchanged without a reading", async () => {
  expect(await extractPdfMarkdown(new ArrayBuffer(0), reading(["", "dos", ""], [3]))).toBe(
    "## Page 1\n\nTexto propio\n\n## Page 2\n\ndos",
  );
  expect(await extractPdfMarkdown(new ArrayBuffer(0))).toBe("## Page 1\n\nTexto propio");
});

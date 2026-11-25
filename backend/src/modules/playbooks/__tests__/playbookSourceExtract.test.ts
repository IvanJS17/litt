import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { extractDocxBodyText } from "../../../lib/docxTrackedChanges";
import { EXTRACTION_OPS } from "../../../lib/extraction/ops";
import { ExtractionBusyError, ExtractionLimitError } from "../../../lib/extraction/isolated";

// The pages and the Word package of a supplementary document are read in the
// parser process, never in this one. The parser's answer is what comes back, so
// a sentinel proves the read did not happen here.
import { extractPlaybookSourceText } from "../playbooks.sources";
import { PlaybookRequestError } from "../playbooks.operations";

const bytes = new TextEncoder().encode("synthetic").buffer as ArrayBuffer;

afterEach(() => vi.restoreAllMocks());

describe("reading a playbook supplementary document", () => {
  it("reads a PDF through the parser", async () => {
    const parse = vi.spyOn(EXTRACTION_OPS, "pdfForModel").mockResolvedValue("from the parser\u0000 pdf");
    await expect(extractPlaybookSourceText("pdf", bytes)).resolves.toBe("from the parser pdf");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("reads a Word file through the parser", async () => {
    const parse = vi.spyOn(EXTRACTION_OPS, "docxText").mockResolvedValue("from the parser docx");
    await expect(extractPlaybookSourceText("docx", bytes)).resolves.toBe("from the parser docx");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("answers 400 for a file the parser cannot read", async () => {
    vi.spyOn(EXTRACTION_OPS, "docxText").mockRejectedValue(new Error("not a zip"));
    const error = await extractPlaybookSourceText("docx", bytes).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlaybookRequestError);
    expect(error).toMatchObject({ status: 400 });
  });

  it("answers a 4xx with the too-large code, not a 500, when the parser's limit stops the file", async () => {
    vi.spyOn(EXTRACTION_OPS, "pdfForModel").mockRejectedValue(new ExtractionLimitError("parser deadline exceeded"));
    const error = await extractPlaybookSourceText("pdf", bytes).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlaybookRequestError);
    expect(error).toMatchObject({ status: 400, code: "request_too_large" });
  });

  it("lets a busy parser through as the typed busy error", async () => {
    vi.spyOn(EXTRACTION_OPS, "docxText").mockRejectedValue(new ExtractionBusyError());
    await expect(extractPlaybookSourceText("docx", bytes)).rejects.toBeInstanceOf(ExtractionBusyError);
  });
});

async function docxWith(body: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("the parser's two Word readers", () => {
  it("docxBodyText is exactly the in-process body text, including when the body is empty", async () => {
    for (const body of [
      "<w:p><w:r><w:t>Liability is unlimited.</w:t></w:r></w:p>",
      "<w:p/>",
      "",
    ]) {
      const bytes = await docxWith(body);
      expect(await EXTRACTION_OPS.docxBodyText(bytes)).toBe(await extractDocxBodyText(Buffer.from(bytes)));
    }
  });

  it("docxText keeps its fallback for a body with no text, which docxBodyText does not", async () => {
    const bytes = await docxWith("<w:p/>");
    expect(await EXTRACTION_OPS.docxBodyText(bytes)).toBe("");
    expect((await EXTRACTION_OPS.docxText(bytes)).trim()).toBe("");
  });
});

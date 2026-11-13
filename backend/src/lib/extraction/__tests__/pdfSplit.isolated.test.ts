// The page copy runs in the bounded parser process: the groups go in as plain
// data and the new files come back over IPC.
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIsolatedExtraction, stopExtractionProcess } from "../isolated";
import { syntheticPdf } from "../../__tests__/pdfFixtures";

beforeEach(() => vi.stubEnv("EXTRACTION_ISOLATION", "on"));
afterEach(async () => {
  await stopExtractionProcess();
  vi.unstubAllEnvs();
});

describe("pdfCopyPages in the isolated parser", () => {
  it("returns one PDF per group over IPC", async () => {
    const pdf = await syntheticPdf(["one", "two", "three"]);
    const files = await runIsolatedExtraction("pdfCopyPages", async () => pdf, { fileType: "pdf", args: { groups: [[1, 2], [3]] } });
    expect(files).toHaveLength(2);
    expect((await PDFDocument.load(files[0])).getPageCount()).toBe(2);
    expect((await PDFDocument.load(files[1])).getPageCount()).toBe(1);
  }, 60_000);

  it("returns the text of each page over IPC", async () => {
    const pdf = await syntheticPdf(["one", null]);
    const read = await runIsolatedExtraction("pdfPageTexts", async () => pdf, { fileType: "pdf" });
    expect(read).toEqual({ pages: ["one", ""], unread: [2] });
  }, 60_000);
});

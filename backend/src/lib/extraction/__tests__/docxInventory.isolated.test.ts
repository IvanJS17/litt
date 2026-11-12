// The preview counts unzip a Word package, and a package can lie about its size:
// the declared size is not what inflates. That unzipping must happen in the
// bounded parser process, not in the API.

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionLimitError, runIsolatedExtraction, stopExtractionProcess } from "../isolated";
import { buildRichDocx } from "../../__tests__/docxFixtures";

beforeEach(() => vi.stubEnv("EXTRACTION_ISOLATION", "on"));
afterEach(async () => {
  await stopExtractionProcess();
  vi.unstubAllEnvs();
});

const toBuffer = (bytes: Buffer) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A package whose word/document.xml inflates to `inflated` bytes but declares 1,000. */
async function lyingDocx(inflated: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", Buffer.alloc(inflated, 0x20), { compression: "DEFLATE" });
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  // Rewrite the uncompressed size in the local header (offset 22) and the central directory (offset 24).
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const sig = bytes.readUInt32LE(i);
    if (sig === 0x04034b50) bytes.writeUInt32LE(1000, i + 22);
    if (sig === 0x02014b50) bytes.writeUInt32LE(1000, i + 24);
  }
  return bytes;
}

describe("docxInventory in the parser process", () => {
  it("counts a real package there", async () => {
    const bytes = await buildRichDocx();
    const counts = await runIsolatedExtraction("docxInventory", async () => toBuffer(bytes), { fileType: "docx" });
    expect(counts).toMatchObject({ comments: 1, images: 1, footnotes: 1 });
  });

  it("cuts a package that lies about its size at the parser's memory limit, without growing the API", async () => {
    vi.stubEnv("EXTRACTION_MAX_MEMORY_MB", "64");
    const bytes = await lyingDocx(200 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const before = process.memoryUsage().rss;
    await expect(
      runIsolatedExtraction("docxInventory", async () => toBuffer(bytes), { fileType: "docx" }),
    ).rejects.toBeInstanceOf(ExtractionLimitError);
    const grown = process.memoryUsage().rss - before;
    // Inflating 200 MB here would grow the process by at least that much.
    expect(grown).toBeLessThan(100 * 1024 * 1024);
  }, 60_000);
});

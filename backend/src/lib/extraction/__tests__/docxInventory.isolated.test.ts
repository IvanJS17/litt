// The preview counts unzip a Word package, and a package can lie about its size:
// the declared size is not what inflates. That unzipping must happen in the
// bounded parser process, not in the API.

import { crc32, deflateRawSync } from "node:zlib";
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

/**
 * A package whose word/document.xml inflates to `inflated` bytes but declares
 * 1,000. Built by hand with native zlib: JSZip's JavaScript deflate takes tens
 * of seconds for hundreds of megabytes, which made this test hit its timeout.
 */
function lyingDocx(inflated: number): Buffer {
  const name = Buffer.from("word/document.xml");
  const content = Buffer.alloc(inflated, 0x20);
  const data = deflateRawSync(content, { level: 9 });
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(1000, 22); // the lie
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(1000, 24); // the lie
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

describe("docxInventory in the parser process", () => {
  it("counts a real package there", async () => {
    const bytes = await buildRichDocx();
    const counts = await runIsolatedExtraction("docxInventory", async () => toBuffer(bytes), { fileType: "docx" });
    expect(counts).toMatchObject({ comments: 1, images: 1, footnotes: 1 });
  });

  it("cuts a package that lies about its size at the parser's memory limit, without growing the API", async () => {
    // A budget above the parser's start-up floor: a valid package passes in it,
    // so the failure below comes from the lying package and not from the budget.
    vi.stubEnv("EXTRACTION_MAX_MEMORY_MB", "512");
    // Whichever bound trips first (memory or deadline) stops it; both are limits.
    vi.stubEnv("EXTRACTION_TIMEOUT_MS", "30000");
    const valid = await buildRichDocx();
    await expect(
      runIsolatedExtraction("docxInventory", async () => toBuffer(valid), { fileType: "docx" }),
    ).resolves.toMatchObject({ comments: 1 });
    const bytes = lyingDocx(640 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    const before = process.memoryUsage().rss;
    await expect(
      runIsolatedExtraction("docxInventory", async () => toBuffer(bytes), { fileType: "docx" }),
    ).rejects.toBeInstanceOf(ExtractionLimitError);
    const grown = process.memoryUsage().rss - before;
    // Inflating 640 MB here would grow the process by at least that much.
    expect(grown).toBeLessThan(100 * 1024 * 1024);
  }, 90_000);
});

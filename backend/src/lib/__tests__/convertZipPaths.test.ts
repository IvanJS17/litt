import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { normalizeDocxZipPaths } from "../convert";

/** A package whose backslash part inflates to `inflated` bytes but declares 1,000. */
async function lyingBackslashDocx(inflated: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word\\document.xml", Buffer.alloc(inflated, 0x20), { compression: "DEFLATE" });
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const sig = bytes.readUInt32LE(i);
    if (sig === 0x04034b50) bytes.writeUInt32LE(1000, i + 22);
    if (sig === 0x02014b50) bytes.writeUInt32LE(1000, i + 24);
  }
  return bytes;
}

describe("normalizeDocxZipPaths", () => {
  it("rewrites backslash parts to forward slashes", async () => {
    const zip = new JSZip();
    zip.file("word\\document.xml", "<w:document/>");
    zip.file("[Content_Types].xml", "<Types/>");
    const out = await normalizeDocxZipPaths(await zip.generateAsync({ type: "nodebuffer" }));
    const names = Object.keys((await JSZip.loadAsync(out)).files);
    expect(names).toContain("word/document.xml");
    expect(names).not.toContain("word\\document.xml");
  });

  it("does not inflate a package that lies about a part's size past the cap", async () => {
    const bytes = await lyingBackslashDocx(120 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    // Over the cap the original comes back untouched instead of being rewritten.
    expect(await normalizeDocxZipPaths(bytes)).toBe(bytes);
  }, 60_000);
});

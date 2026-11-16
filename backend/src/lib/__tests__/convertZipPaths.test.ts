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

  it("renames a package that lies about a part's size without inflating it", async () => {
    const bytes = await lyingBackslashDocx(120 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    // The rename edits the name bytes in place (upstream c12): no part is
    // inflated, so the lie about the size cannot cost memory or time.
    const out = await normalizeDocxZipPaths(bytes);
    expect(out.length).toBe(bytes.length);
    expect(out.includes("word/document.xml")).toBe(true);
    expect(out.includes("word\\document.xml")).toBe(false);
  }, 60_000);
});

// Word → Markdown inside the real bounded parser process: turndown and its DOM
// (domino) load there, and an unreadable file comes back as an error rather
// than as an empty text.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIsolatedExtraction, stopExtractionProcess } from "../isolated";
import { buildRichDocx, FIXTURE_TEXT } from "../../__tests__/docxFixtures";

beforeEach(() => vi.stubEnv("EXTRACTION_ISOLATION", "on"));
afterEach(async () => {
  await stopExtractionProcess();
  vi.unstubAllEnvs();
});

describe("docxMarkdown in the parser process", () => {
  it("converts a Word file there", async () => {
    const bytes = await buildRichDocx();
    const md = await runIsolatedExtraction(
      "docxMarkdown",
      async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { fileType: "docx" },
    );
    expect(md).toContain(`# ${FIXTURE_TEXT.title}`);
    expect(md).toContain("| Asesoría | 1,500 |");
  });

  it("fails on a file that is not a Word file", async () => {
    await expect(
      runIsolatedExtraction("docxMarkdown", async () => new TextEncoder().encode("nope").buffer as ArrayBuffer, {
        fileType: "docx",
      }),
    ).rejects.toThrow();
  });
});

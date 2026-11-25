import { describe, expect, it, vi } from "vitest";
import { expectLinearCostAsync } from "../../../../../__tests__/helpers/linearCost";

// A generated document's lines are typed by a model: its list markers are read
// in time proportional to the length of the line.

vi.mock("../../../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/storage")>()),
  uploadFile: vi.fn(async () => {}),
  downloadFile: vi.fn(async () => null),
}));
vi.mock("../../../../../lib/convert", () => ({
  docxToPdf: vi.fn(async () => Buffer.from("pdf-bytes")),
  convertedPdfKey: (userId: string, docId: string) => `converted-pdfs/${userId}/${docId}.pdf`,
}));
vi.mock("../../../../../lib/queue/conversionQueue", () => ({
  enqueueConversion: vi.fn(async () => ({})),
}));
vi.mock("../../../../../lib/supabase", () => ({
  createServerSupabase: vi.fn(),
}));

import { generateDocx } from "../documentOps";

process.env.DOWNLOAD_SIGNING_SECRET = "test-secret-32-bytes-long-enough!!";

function makeDb() {
  const from = () => {
    const b: Record<string, unknown> = {
      insert: () => b,
      update: () => b,
      select: () => b,
      eq: () => b,
      single: () => Promise.resolve({ data: { id: "doc-db-1" }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onF),
    };
    return b;
  };
  return {
    from,
    rpc: vi.fn(async (_name: string, args: { p_version: Record<string, unknown> }) => ({ data: { ...args.p_version, id: "ver-db-1" }, error: null })),
  };
}

// The fixed cost of building a document is a large part of a short line, so the sizes are wide apart.
const SIZE = { small: 4_000, large: 128_000 };

const generate = (content: string, heading = "Clause") =>
  generateDocx("Agreement", [{ heading, content }], "user-1", makeDb() as never, { numberSections: true, projectId: null, orgId: null, userEmail: null });

describe("list markers of a generated document", () => {
  // A marker, a long run of blanks, then text and a line separator that is not a line break.
  const lines: [string, (n: number) => string][] = [
    ["a numbered line", (n) => "1" + " ".repeat(n) + "x\u2028y"],
    ["a lettered line", (n) => "a." + " ".repeat(n) + "x\u2028y"],
    ["a bullet line", (n) => "-" + " ".repeat(n) + "x\u2028y"],
  ];
  for (const [what, line] of lines) {
    it(`reads ${what} in linear time`, async () => {
      await expectLinearCostAsync(async (n) => {
        const result = await generate(line(n));
        expect(result).not.toHaveProperty("error");
      }, SIZE);
    });
  }
  it("reads a numbered heading in linear time", async () => {
    await expectLinearCostAsync(async (n) => {
      const result = await generate("Body.", "1" + " ".repeat(n) + "x\u2028y");
      expect(result).not.toHaveProperty("error");
    }, SIZE);
  });
});

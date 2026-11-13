import { describe, expect, it } from "vitest";
import { findTextlessPdfPages } from "../pdfText";

/** Three pages; only the second has text (pdf.js rebuilds the xref). */
function pdf(): ArrayBuffer {
  const stream = "BT /F1 12 Tf 20 100 Td (Hello) Tj ET";
  const page = (n: number, contents: string) =>
    `${n} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ${contents} /Resources << /Font << /F1 7 0 R >> >> >> endobj`;
  const source = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj",
    page(3, ""),
    page(4, "/Contents 6 0 R"),
    page(5, ""),
    `6 0 obj << /Length ${stream.length} >> stream`,
    stream,
    "endstream endobj",
    "7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
  return new TextEncoder().encode(source).buffer as ArrayBuffer;
}

describe("findTextlessPdfPages", () => {
  it("lists the 1-indexed pages without a text layer and the page total", async () => {
    expect(await findTextlessPdfPages(pdf())).toEqual({ pages: [1, 3], total: 3 });
  });
});

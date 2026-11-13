import { PDFDocument, StandardFonts } from "pdf-lib";

/** A synthetic PDF: one entry per page, a string is drawn on it and null leaves it blank. */
export async function syntheticPdf(pages: (string | null)[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([300, 300]);
    if (text) page.drawText(text, { x: 20, y: 150, size: 14, font });
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

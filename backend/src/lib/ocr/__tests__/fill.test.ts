import { describe, expect, it } from "vitest";
import { fillPagesFromOcr } from "../../pdfText";
import { OCR_PAGE_BREAK } from "../pages";

const page = (n: number, body: string) => ({ text: `[Page ${n}]\n${body}`, empty: body === "" });
const pages = [page(1, "Texto propio"), page(2, ""), page(3, ""), page(4, "")];
const reading = (parts: string[], failedPages: number[] = []) => ({ markdown: parts.join(`\n\n${OCR_PAGE_BREAK}\n\n`), failedPages });

describe("fillPagesFromOcr", () => {
  it("fills only pages without a text layer, page by page", () => {
    const out = fillPagesFromOcr(pages, reading(["ignorado", "dos", "tres", "cuatro"]));
    expect(out.map((p) => p.text)).toEqual(["[Page 1]\nTexto propio", "[Page 2]\ndos", "[Page 3]\ntres", "[Page 4]\ncuatro"]);
    expect(out.every((p) => !p.empty)).toBe(true);
  });
  it("leaves a page LandingAI failed on unread, and counts a blank page it read as read", () => {
    const out = fillPagesFromOcr(pages, reading(["", "", "", ""], [3]));
    expect(out.map((p) => p.empty)).toEqual([false, false, true, false]);
  });
  it("puts the whole reading on the first empty page when the breaks do not match", () => {
    const out = fillPagesFromOcr(pages, { markdown: "todo junto" });
    expect(out[1].text).toBe("[Page 2]\ntodo junto");
    expect(out[2].empty).toBe(false);
    expect(out[2].text).toBe("[Page 3]\n");
  });
});

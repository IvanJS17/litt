import { describe, expect, it } from "vitest";
import { fillPagesFromOcr } from "../../pdfText";

const page = (n: number, body: string) => ({ text: `[Page ${n}]\n${body}`, empty: body === "" });
const pages = [page(1, "Texto propio"), page(2, ""), page(3, ""), page(4, "")];

describe("fillPagesFromOcr", () => {
  it("fills only pages without a text layer, by real page number", () => {
    const out = fillPagesFromOcr(pages, {
      pages: [{ page: 1, text: "ignorado" }, { page: 2, text: "dos" }, { page: 4, text: "cuatro" }, { page: 3, text: "tres" }],
    });
    expect(out.map((p) => p.text)).toEqual(["[Page 1]\nTexto propio", "[Page 2]\ndos", "[Page 3]\ntres", "[Page 4]\ncuatro"]);
    expect(out.every((p) => !p.empty)).toBe(true);
  });
  it("leaves a failed page, or one the reading does not have, unread; a blank page it read counts as read", () => {
    const out = fillPagesFromOcr(pages, {
      pages: [{ page: 2, text: "" }, { page: 3, text: "tres" }],
      failedPages: [3],
    });
    expect(out.map((p) => p.empty)).toEqual([false, false, true, true]);
  });
});

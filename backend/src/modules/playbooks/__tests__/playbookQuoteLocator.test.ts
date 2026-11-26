// The quote a review finding points at is looked up in the document's text:
// whitespace and case may differ, and the cost stays in proportion to the
// text however repetitive it is.
import { describe, expect, it } from "vitest";
import { blankPlaybookContent, linearIndexOf, normalizeFindings } from "../playbooks.operations";

const content = () => ({
  ...blankPlaybookContent("Guide"),
  rules: [{ id: "r1", name: "Cap", concept: "c", scope: "clause" as const, required: false, guidance: "",
    standard: null, fallbacks: [], unacceptable: [], conditions: [], actions: [], sourceRefs: [] }],
});

const locate = (document: string, quote: string, insertAfter = "") =>
  normalizeFindings(content(), document, [
    { ruleId: "r1", ruleName: "Cap", status: "needs_review", quote, location: "", suggestedText: "", insertAfter, analysis: "a" },
  ] as never, { flagMissingRules: false })[0]!;

describe("locating a quote in the document text", () => {
  it("returns an exact quote as given", () => {
    expect(locate("The Cap  applies.", "Cap  applies").quote).toBe("Cap  applies");
  });

  it("finds a quote that differs in case and spacing, as the document writes it", () => {
    expect(locate("Liability is\n  capped at FEES paid.", "liability is capped at fees paid").quote).toBe(
      "Liability is\n  capped at FEES paid",
    );
    expect(locate("Pay within 30 days.", "  within   30  DAYS ", "pay").insertAfter).toBe("Pay");
  });

  it("returns nothing for a quote that is not in the text", () => {
    expect(locate("Liability is capped.", "liability is uncapped").quote).toBe("");
    expect(locate("short", "a much longer quote than the text").quote).toBe("");
    expect(locate("anything", "   ").quote).toBe("");
  });

  it("finds quotes with characters outside the basic plane, answering with the document's own text", () => {
    const document = "Pay 😀 now.\nThen  grin 😃😃 twice, ÑANDÚ 𝐀𝐛 end.";
    expect(locate(document, "Pay 😀 now").quote).toBe("Pay 😀 now");
    expect(locate(document, "pay   😀\tNOW").quote).toBe("Pay 😀 now");
    expect(locate(document, "then grin 😃😃 TWICE").quote).toBe("Then  grin 😃😃 twice");
    expect(locate(document, "ñandú 𝐀𝐛 end", "pay 😀").insertAfter).toBe("Pay 😀");
  });

  it("returns nothing for a quote with such a character that is not in the document", () => {
    const document = "Pay 😃 now, 𝐀 and 😀😀";
    expect(locate(document, "Pay 😀").quote).toBe("");
    expect(locate(document, "pay 😀 now").quote).toBe("");
    expect(locate(document, "😀😃").quote).toBe("");
    expect(locate(document, "x 𝐁").quote).toBe("");
  });

  it("never answers with half of a character", () => {
    const answer = locate("Pay 😀 now", "pay   😀").quote;
    expect(answer).toBe("Pay 😀");
    expect(answer).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });
});

/** Reads of an array, counted: the work of a search, not the time it took on a loaded machine. */
function readsOf(haystack: string, needle: string): number {
  let reads = 0;
  const counted = (text: string) =>
    new Proxy(Uint16Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)), {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key);
      },
    });
  linearIndexOf(counted(haystack), haystack.length, counted(needle));
  return reads;
}

describe("the cost of locating a quote", () => {
  it("grows with the text plus the quote, not with their product, on a repetitive document", () => {
    const at = (n: number) => readsOf("x ".repeat(n), `${"x ".repeat(n / 15)}y`);
    const small = at(3_000);
    const large = at(12_000); // text and quote four times as long
    expect(large / small, `${small} reads, then ${large}`).toBeLessThan(4.5);
    expect(large).toBeLessThan(6 * (24_000 + 1_600));
  });
});

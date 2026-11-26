// The quote a review finding points at is looked up in the document's text:
// whitespace and case may differ, and the cost stays in proportion to the
// text however repetitive it is.
import { describe, expect, it } from "vitest";
import { blankPlaybookContent, normalizeFindings } from "../playbooks.operations";

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

  it("answers in time proportional to the text on a repetitive document", () => {
    const document = "x ".repeat(30_000);
    const quote = `${"X ".repeat(2_000)}y`;
    const started = performance.now();
    expect(locate(document, quote, quote).quote).toBe("");
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

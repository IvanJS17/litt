import { describe, expect, it } from "vitest";
import { compareTexts, diffWords, type DiffSegment, type TextChange } from "./textDiff";

function rebuild(segments: DiffSegment[], side: "before" | "after") {
  const skip = side === "before" ? "added" : "removed";
  return segments
    .filter((segment) => segment.type !== skip)
    .map((segment) => segment.text)
    .join("");
}

describe("diffWords", () => {
  it("marks only the words that changed", () => {
    const segments = diffWords(
      "Liability is unlimited for all claims.",
      "Liability is capped at fees paid for all claims.",
    );
    expect(segments).toEqual([
      { type: "equal", text: "Liability is " },
      { type: "removed", text: "unlimited " },
      { type: "added", text: "capped at fees paid " },
      { type: "equal", text: "for all claims." },
    ]);
  });

  it.each([
    ["The Supplier shall indemnify the Customer.", "The Customer shall indemnify the Supplier promptly."],
    ["", "A whole new clause."],
    ["A clause to delete.", ""],
    ["Same  text\nwith odd   spacing.", "Same  text\nwith odd   spacing."],
  ])("rebuilds both sides exactly from %j to %j", (before, after) => {
    const segments = diffWords(before, after);
    expect(rebuild(segments, "before")).toBe(before);
    expect(rebuild(segments, "after")).toBe(after);
  });

  it("treats identical text as unchanged and empty text as nothing", () => {
    expect(diffWords("No change.", "No change.")).toEqual([
      { type: "equal", text: "No change." },
    ]);
    expect(diffWords("", "")).toEqual([]);
  });

  it("falls back to a whole replacement for very different long text", () => {
    const before = Array.from({ length: 1000 }, (_, i) => `a${i}`).join(" ");
    const after = Array.from({ length: 1000 }, (_, i) => `b${i}`).join(" ");
    expect(diffWords(before, after)).toEqual([
      { type: "removed", text: before },
      { type: "added", text: after },
    ]);
  });
});

function ok(base: string, head: string, limits = {}) {
  const outcome = compareTexts(base, head, limits);
  if (outcome.status !== "ok") throw new Error("expected a comparison");
  return outcome.comparison;
}

describe("compareTexts", () => {
  it("finds no changes in identical text, whatever the line endings", () => {
    expect(ok("a\nb\n", "a\r\nb").changes).toEqual([]);
    expect(ok("", "").items).toEqual([]);
  });

  it("groups rewritten lines into one change and marks the words", () => {
    const { changes } = ok(
      "Intro\nEl plazo es de 30 días.\nFin\n",
      "Intro\nEl plazo es de 45 días.\nFin\n",
    );
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change.removed[0].segments).toEqual([
      { type: "equal", text: "El plazo es de " },
      { type: "removed", text: "30" },
      { type: "equal", text: " días." },
    ]);
    expect(change.added[0].segments.find((s) => s.type === "added")?.text).toBe("45");
    expect(change.numeric).toBe(true);
    expect([change.removed[0].no, change.added[0].no]).toEqual([2, 2]);
  });

  it("reads a digit only in the changed fragment, not in the line", () => {
    const { changes } = ok(
      "Cláusula 3 sobre pagos\n",
      "Cláusula 3 sobre cobros\n",
    );
    expect(changes[0].numeric).toBe(false);
  });

  it("treats whole added and removed lines as changed text", () => {
    const { changes } = ok("a\nb\n", "a\nb\nVigencia 2027\n");
    expect(changes).toHaveLength(1);
    expect(changes[0].removed).toEqual([]);
    expect(changes[0].added[0].segments).toEqual([
      { type: "added", text: "Vigencia 2027" },
    ]);
    expect(changes[0].numeric).toBe(true);
    const removedOnly = ok("a\nquitar\nb\n", "a\nb\n").changes[0];
    expect(removedOnly.added).toEqual([]);
    expect(removedOnly.summary).toBe("quitar");
  });

  it("pairs lines by position and leaves the extra ones whole", () => {
    const [change] = ok("uno\ndos\n", "UNO\nDOS\ntres\n").changes;
    expect(change.removed).toHaveLength(2);
    expect(change.added.map((l) => l.text)).toEqual(["UNO", "DOS", "tres"]);
  });

  it("names the nearest heading and the paragraph of each change", () => {
    const { changes } = ok(
      "# Uno\ntexto\n\n## Dos ##\notro\nfin\n",
      "# Uno\ntexto\n\n## Dos ##\notro cambiado\nfin\n\n# Tres\n",
    );
    const [first, second] = changes as TextChange[];
    expect(first.heading).toBe("Dos");
    expect(first.paragraph).toBe(4);
    expect(second.heading).toBe("Tres");
    expect(ok("a\n", "b\n").changes[0].heading).toBeNull();
  });

  it("refuses text over the line or size limits", () => {
    expect(compareTexts("a\nb\nc\n", "a\n", { maxLines: 2 })).toEqual({
      status: "too_large",
    });
    expect(compareTexts("a", "bbbbbb", { maxChars: 3 })).toEqual({
      status: "too_large",
    });
  });

  it("refuses a diff that does not finish in time", () => {
    const lines = (prefix: string) =>
      Array.from({ length: 5000 }, (_, i) => `${prefix}${i}`).join("\n");
    expect(compareTexts(lines("a"), lines("b"), { timeoutMs: 1 })).toEqual({
      status: "too_large",
    });
  });
});

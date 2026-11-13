import { describe, expect, it } from "vitest";
import { compareTexts, type TextComparison } from "./textDiff";
import {
    CONTEXT_LINES,
    compareBlocks,
    compareReadiness,
    groupChanges,
    isMarkdownName,
    versionAuthor,
} from "./versionCompare";

function comparison(base: string, head: string): TextComparison {
    const outcome = compareTexts(base, head);
    if (outcome.status !== "ok") throw new Error("too large");
    return outcome.comparison;
}

describe("versionAuthor", () => {
    it.each([
        ["assistant_edit", "ai"],
        ["generated", "ai"],
        ["upload", "person"],
        ["user_upload", "person"],
        ["user_edit", "person"],
        ["user_accept", "person"],
        ["user_reject", "person"],
        [null, "person"],
        [undefined, "person"],
    ] as const)("reads %s as %s", (source, expected) => {
        expect(versionAuthor(source)).toBe(expected);
    });
});

describe("compareBlocks", () => {
    const lines = (n: number, mark = "") =>
        Array.from({ length: n }, (_, i) => `line ${i + 1}${mark}`).join("\n");

    it("keeps a few lines around a change and folds the rest into a gap", () => {
        const base = lines(20);
        const head = base.replace("line 10", "LINE 10");
        const blocks = compareBlocks(comparison(base, head), () => true);
        const kinds = blocks.map((b) => b.kind);
        expect(kinds.filter((k) => k === "change")).toHaveLength(1);
        expect(kinds.filter((k) => k === "context")).toHaveLength(CONTEXT_LINES * 2);
        const gaps = blocks.filter((b) => b.kind === "gap");
        expect(gaps.map((g) => g.kind === "gap" && g.count)).toEqual([6, 7]);
        // A gap keeps the lines it folds, so it can be opened.
        expect(gaps.map((g) => g.kind === "gap" && g.hidden.length)).toEqual([6, 7]);
    });

    it("shows a short unchanged run whole", () => {
        const blocks = compareBlocks(comparison("a\nb\nc\n", "a\nB\nc\n"), () => true);
        expect(blocks.map((b) => b.kind)).toEqual(["context", "change", "context"]);
    });

    it("folds a hidden change into a gap", () => {
        const base = Array.from({ length: 30 }, (_, i) => `word ${String.fromCharCode(97 + (i % 26))}${i > 25 ? "x" : ""}`).join("\n");
        const head = base.replace("word c\n", "word cc\n").replace("word w\n", "word w 7\n");
        const result = comparison(base, head);
        const blocks = compareBlocks(result, (change) => change.numeric);
        expect(blocks.filter((b) => b.kind === "change")).toHaveLength(1);
        expect(compareBlocks(result, () => false).every((b) => b.kind === "gap")).toBe(true);
        // Only the gaps that fold a change say so; a gap of plain unchanged lines does not.
        const gaps = compareBlocks(result, (change) => change.numeric).filter((b) => b.kind === "gap");
        expect(gaps.map((g) => g.kind === "gap" && g.withChanges)).toContain(true);
        expect(gaps.map((g) => g.kind === "gap" && g.withChanges)).toContain(false);
    });

    it("draws only a gap for identical text", () => {
        expect(compareBlocks(comparison("a\n", "a\n"), () => true).map((b) => b.kind)).toEqual(["gap"]);
    });
});

describe("groupChanges", () => {
    const { changes } = comparison("# A\nx\n\n# B\ny\n", "# A\nx2\n\n# B\ny2\n");

    it("groups by the nearest heading in a .md", () => {
        const groups = groupChanges(changes, true);
        expect(groups.map((g) => g.heading)).toEqual(["A", "B"]);
        expect(groups.map((g) => g.changes.length)).toEqual([1, 1]);
    });

    it("joins changes under the same heading and keeps one group otherwise", () => {
        const same = comparison("# A\nx\ny\nz\n", "# A\nX\ny\nZ\n").changes;
        expect(groupChanges(same, true)).toHaveLength(1);
        expect(groupChanges(changes, false)).toEqual([{ heading: null, changes }]);
        expect(groupChanges([], false)).toEqual([]);
    });
});

describe("compareReadiness", () => {
    const ready = { text_status: "ready", text: "x", too_large: false } as const;

    it("is ready when both texts are there", () => {
        expect(compareReadiness(ready, ready)).toEqual({ kind: "ready" });
    });

    it.each(["pending", "failed", "none"] as const)("has no text while a side is %s", (status) => {
        expect(compareReadiness({ ...ready, text_status: status, text: null }, ready)).toEqual({
            kind: "no_text",
        });
    });

    it("reports a withheld text as too large, and a missing one as no text", () => {
        expect(compareReadiness(ready, { ...ready, text: null, too_large: true })).toEqual({
            kind: "too_large",
        });
        expect(compareReadiness(ready, { ...ready, text: null })).toEqual({ kind: "no_text" });
    });
});

describe("isMarkdownName", () => {
    it("reads the extension", () => {
        expect(isMarkdownName("Notes.MD")).toBe(true);
        expect(isMarkdownName("a.markdown")).toBe(true);
        expect(isMarkdownName("a.docx")).toBe(false);
        expect(isMarkdownName(null)).toBe(false);
    });
});

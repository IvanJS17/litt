import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../__tests__/helpers/linearCost";
import { bulletListMarker, letteredListMarker, numberedListMarker } from "../modelJsonFence";

// The expressions these scans replaced, kept here as the reference they must agree with.
const OLD_NUMBERED = /^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/;
const OLD_LETTERED = /^(\(([a-z]+)\)|([a-z]+)[.)])\s+(.+)$/i;
const OLD_BULLET = /^[-•*]\s+(.+)/;

const oldNumbered = (line: string) => {
    const m = line.match(OLD_NUMBERED);
    return m ? { marker: m[1], text: m[2] } : null;
};
const oldLettered = (line: string) => {
    const m = line.match(OLD_LETTERED);
    return m ? { marker: m[2] ?? m[3], text: m[4] } : null;
};
const oldBullet = (line: string) => line.match(OLD_BULLET)?.[1] ?? null;

// Lines of the kinds a document has: markers, the blanks after them, and text, put together by a
// generator with a fixed seed, so a failure repeats.
function lines(count: number): string[] {
    let seed = 20261121;
    const next = (n: number) => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed % n;
    };
    const markers = ["", "-", "•", "*", "–", "1", "1.", "12)", "1.2", "1.2.3.", "1.2.", "1..2", "1.2)", "01.", "(a)", "(A)", "a.", "B)", "iv)", "(ii)", "(xiv)", "ab.", "(a", "a", "ſ.", "ı)", "K.", "١.", "1a.", "-1.", "(1)"];
    const blanks = ["", " ", "  ", "\t", " \t ", "\u00a0", "\u2003", "\u3000", "\ufeff", "\u2028", "\u2029", "\r", "\n", " \u2028 ", "\u2028 "];
    const texts = ["", "text", "Two words", "x", "é", "😀", "a\u2028b", "line\rbreak", "1.2", "- x", "(a) b", " ", "  x  ", "x\u2028", "\u2029x"];
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        let line = markers[next(markers.length)] + blanks[next(blanks.length)] + texts[next(texts.length)];
        if (next(4) === 0) line += blanks[next(blanks.length)] + texts[next(texts.length)];
        if (next(6) === 0) line = blanks[next(blanks.length)] + line;
        out.push(line);
    }
    return out;
}

describe("list markers", () => {
    it("reads the lines of an ordinary document as the earlier expressions did", () => {
        const cases = [...lines(60_000), ...lines(60_000).map((line) => line.trim())];
        let matched = 0;
        for (const line of cases) {
            for (const [what, now, before] of [
                ["numbered", numberedListMarker, oldNumbered],
                ["lettered", letteredListMarker, oldLettered],
                ["bullet", bulletListMarker, oldBullet],
            ] as const) {
                const expected = before(line);
                if (expected !== null) matched++;
                expect(now(line), `${what}: ${JSON.stringify(line)}`).toEqual(expected);
            }
        }
        expect(matched).toBeGreaterThan(20_000);
    });

    it("reads the marker of each ordinary kind", () => {
        expect(numberedListMarker("1. Scope")).toEqual({ marker: "1", text: "Scope" });
        expect(numberedListMarker("2.3.1) Term of years")).toEqual({ marker: "2.3.1", text: "Term of years" });
        expect(numberedListMarker("12 Notes")).toEqual({ marker: "12", text: "Notes" });
        expect(numberedListMarker("1.Scope")).toBeNull();
        expect(numberedListMarker("1.")).toBeNull();
        expect(letteredListMarker("(a) Payment")).toEqual({ marker: "a", text: "Payment" });
        expect(letteredListMarker("B) Payment")).toEqual({ marker: "B", text: "Payment" });
        expect(letteredListMarker("iv. Payment")).toEqual({ marker: "iv", text: "Payment" });
        expect(letteredListMarker("a) ")).toBeNull();
        expect(bulletListMarker("•\tPayment due")).toBe("Payment due");
        expect(bulletListMarker("- Payment")).toBe("Payment");
        expect(bulletListMarker("-Payment")).toBeNull();
        expect(bulletListMarker("*")).toBeNull();
    });

    // A marker, a long run of blanks, and text with a separator that is not a line break.
    const blanksThenText = (marker: string) => (n: number) => marker + " ".repeat(n) + "x\u2028y";
    const SIZE = { small: 2_000, large: 64_000 };
    it("reads a numbered marker in linear time", () => {
        expectLinearCost((n) => numberedListMarker(blanksThenText("1")(n)), SIZE);
        expectLinearCost((n) => numberedListMarker(blanksThenText("1.2.3.")(n)), SIZE);
        expectLinearCost((n) => numberedListMarker("1" + "\u2028".repeat(n) + "y"), SIZE);
        expectLinearCost((n) => numberedListMarker("1.".repeat(n) + "x"), SIZE);
    });
    it("reads a lettered marker in linear time", () => {
        expectLinearCost((n) => letteredListMarker(blanksThenText("a.")(n)), SIZE);
        expectLinearCost((n) => letteredListMarker(blanksThenText("(a)")(n)), SIZE);
        expectLinearCost((n) => letteredListMarker("a".repeat(n) + "!"), SIZE);
    });
    it("reads a bullet marker in linear time", () => {
        expectLinearCost((n) => bulletListMarker(blanksThenText("-")(n)), SIZE);
        expectLinearCost((n) => bulletListMarker("-" + "\u2028".repeat(n)), SIZE);
        expectLinearCost((n) => bulletListMarker("-" + " ".repeat(n)), SIZE);
    });
});

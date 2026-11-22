import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../../__tests__/helpers/linearCost";
import { MODEL_TEXT_MAX_CHARS } from "../../../lib/modelJsonFence";
import { parseGenerative } from "../requests.triage.shared";

describe("parseGenerative on a long answer", () => {
    it("reads a fenced answer padded with blanks in linear time", () => {
        // Cubic cost: the sizes stay small enough to measure before the bound.
        expectLinearCost((n) => parseGenerative("```" + " ".repeat(n) + "x"), { small: 48, large: 1_536 });
    });
    it("refuses an answer over the shared bound", () => {
        expect(parseGenerative(" ".repeat(MODEL_TEXT_MAX_CHARS + 1))).toBeNull();
    });
});

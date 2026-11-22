import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../../__tests__/helpers/linearCost";
import { MODEL_TEXT_MAX_CHARS } from "../../../lib/modelJsonFence";
import { readModelArray } from "../client-profile.extract.shared";

describe("readModelArray on a long answer", () => {
    it("reads a fenced answer padded with blanks in linear time", () => {
        // Cubic cost: the sizes stay small enough to measure before the bound.
        expectLinearCost((n) => readModelArray("```" + " ".repeat(n) + "x"), { small: 48, large: 1_536 });
        expectLinearCost((n) => readModelArray("```json\n[" + " ".repeat(n) + "]\n```"), { small: 2_000, large: 64_000 });
    });
    it("reads the array out of a padded fence", () => {
        expect(readModelArray("```json\n[1," + " ".repeat(50_000) + "2]\n```")).toEqual([1, 2]);
    });
    it("refuses an answer over the shared bound", () => {
        expect(readModelArray("[" + "1,".repeat(MODEL_TEXT_MAX_CHARS / 2) + "1]")).toBeNull();
    });
});

import { describe, expect, it } from "vitest";
import { scoreGymAttempt } from "./trainingGym";

describe("scoreGymAttempt", () => {
    const errors = [
        { paragraph: 2, kind: "repealed_article" as const },
        { paragraph: 4, kind: "other" as const },
        { paragraph: 5, kind: "invented_citation" as const },
    ];

    it("counts an error as found by its paragraph alone; the kind is a separate fact", () => {
        const score = scoreGymAttempt(errors, [
            { paragraph: 2, kind: "repealed_article" },
            { paragraph: 4, kind: "wrong_jurisdiction" },
            { paragraph: 1, kind: "other" },
        ]);
        expect(score).toEqual({
            found: [
                { error_index: 0, paragraph: 2, kind_matches: true },
                { error_index: 1, paragraph: 4, kind_matches: false },
            ],
            missed: [{ error_index: 2, paragraph: 5 }],
            extra: [{ paragraph: 1 }],
        });
    });

    it("has nothing found when nothing was marked", () => {
        expect(scoreGymAttempt(errors, [])).toEqual({
            found: [],
            missed: errors.map((error, error_index) => ({ error_index, paragraph: error.paragraph })),
            extra: [],
        });
    });
});

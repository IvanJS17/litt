import { describe, expect, it } from "vitest";
import { draftFrom, draftProblem, draftToClasses, isBuiltIn, isChanged, SPLIT_DESCRIPTION_MAX, SPLIT_IDENTIFIER_MAX, SPLIT_NAME_MAX } from "./splitClassesDraft";

const base = [
    { name: "Poder", description: "Un poder notarial." },
    { name: "Constancia", description: "Constancia fiscal.", identifier: "RFC" },
];

describe("the draft of the list of types", () => {
    it("turns saved types into rows and back, trimming and leaving out an empty identifier", () => {
        const draft = draftFrom(base, 10);
        expect(draft.map((r) => [r.key, r.identifier])).toEqual([[10, ""], [11, "RFC"]]);
        expect(draftToClasses(draft)).toEqual(base);
        draft[0] = { ...draft[0], name: "  Poder \n notarial ", identifier: "   " };
        expect(draftToClasses(draft)[0]).toEqual({ name: "Poder notarial", description: "Un poder notarial." });
    });

    it("finds the first problem, by code", () => {
        const ok = draftFrom(base);
        expect(draftProblem(ok, 19)).toBeNull();
        expect(draftProblem([], 19)).toBe("empty");
        expect(draftProblem(ok, 1)).toBe("too_many");
        expect(draftProblem([{ ...ok[0], name: " " }], 19)).toBe("name");
        expect(draftProblem([{ ...ok[0], name: "n".repeat(SPLIT_NAME_MAX + 1) }], 19)).toBe("name");
        expect(draftProblem([{ ...ok[0], description: "" }], 19)).toBe("description");
        expect(draftProblem([{ ...ok[0], description: "d".repeat(SPLIT_DESCRIPTION_MAX + 1) }], 19)).toBe("description");
        expect(draftProblem([{ ...ok[0], identifier: "i".repeat(SPLIT_IDENTIFIER_MAX + 1) }], 19)).toBe("identifier");
        expect(draftProblem([ok[0], { ...ok[1], name: "PODER" }], 19)).toBe("duplicate");
        expect(draftProblem([{ ...ok[0], name: "Uncategorized" }], 19)).toBe("reserved");
    });

    it("knows when the draft is the built-in list and when it differs from what is saved", () => {
        expect(isBuiltIn(draftFrom(base), base)).toBe(true);
        expect(isBuiltIn(draftFrom(base).slice(1), base)).toBe(false);
        expect(isChanged(draftFrom(base), base)).toBe(false);
        expect(isChanged(draftFrom([base[0]]), base)).toBe(true);
        const edited = draftFrom(base);
        edited[0] = { ...edited[0], description: "Otra." };
        expect(isChanged(edited, base)).toBe(true);
    });
});

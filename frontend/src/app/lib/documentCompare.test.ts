import { describe, expect, it } from "vitest";
import { canCompareFileType, compareCandidates } from "./documentCompare";

describe("canCompareFileType", () => {
    it.each([
        ["docx", true],
        ["DOCX", true],
        ["pdf", false],
        ["md", false],
        ["doc", false],
        ["", false],
        [null, false],
        [undefined, false],
    ])("%s → %s", (type, expected) => {
        expect(canCompareFileType(type)).toBe(expected);
    });
});

describe("compareCandidates", () => {
    const docs = [
        { id: "a", file_type: "docx" },
        { id: "b", file_type: "docx" },
        { id: "c", file_type: "pdf" },
        { id: "d", file_type: "md" },
        { id: "e", file_type: "docx", held: true },
        { id: "f" },
    ];
    it("leaves out the document itself and every file that is not Word", () => {
        expect(compareCandidates(docs, "a").map((d) => d.id)).toEqual(["b", "e"]);
    });
    it("leaves out what the caller holds back", () => {
        expect(compareCandidates(docs, "a", (d) => "held" in d).map((d) => d.id)).toEqual(["b"]);
    });
});

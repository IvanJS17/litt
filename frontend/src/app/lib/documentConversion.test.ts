import { describe, expect, it } from "vitest";
import {
    CONVERT_ACTION_KEYS,
    CONVERT_LOSS_KEYS,
    CONVERT_TARGET_KEYS,
    conversionTargetsFor,
    detectedLines,
} from "./documentConversion";
import enUS from "../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../packages/i18n/messages/es-MX.json";

const NONE = { comments: 0, tracked_insertions: 0, tracked_deletions: 0, images: 0, footnotes: 0, headers: 0, footers: 0 };

describe("conversionTargetsFor", () => {
    it.each([
        ["md", ["docx", "pdf"]],
        ["MD", ["docx", "pdf"]],
        ["docx", ["md", "pdf"]],
        ["pdf", ["md"]],
        ["doc", []],
        ["xlsx", []],
        ["pptx", []],
        [null, []],
        [undefined, []],
    ])("offers %s the targets that exist, and never PDF → Word", (fileType, targets) => {
        expect(conversionTargetsFor(fileType)).toEqual(targets);
    });
});

describe("detectedLines", () => {
    it("says nothing for a document that is not a Word file", () => {
        expect(detectedLines("md", null)).toEqual([]);
    });

    it("lists only what the Word file holds, with the counts, to Markdown", () => {
        expect(
            detectedLines("md", { comments: 12, tracked_insertions: 3, tracked_deletions: 2, images: 2, footnotes: 0, headers: 1, footers: 1 }),
        ).toEqual([
            { key: "documents.convert.detected.comments", count: 12 },
            { key: "documents.convert.detected.trackedChanges", count: 5 },
            { key: "documents.convert.detected.images", count: 2 },
            { key: "documents.convert.detected.headersFooters", count: 2 },
        ]);
        expect(detectedLines("md", NONE)).toEqual([]);
    });

    it("only warns about tracked changes to PDF, and about nothing to Word", () => {
        const detected = { ...NONE, comments: 4, images: 1, tracked_deletions: 1 };
        expect(detectedLines("pdf", detected)).toEqual([{ key: "documents.convert.detected.trackedChangesPdf", count: 1 }]);
        expect(detectedLines("pdf", NONE)).toEqual([]);
        expect(detectedLines("docx", detected)).toEqual([]);
    });
});

describe("the catalog behind the codes", () => {
    const resolve = (catalog: unknown, key: string) =>
        key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
    const keys = [
        ...Object.values(CONVERT_ACTION_KEYS),
        ...Object.values(CONVERT_TARGET_KEYS),
        ...Object.values(CONVERT_LOSS_KEYS),
    ];

    it.each([["en-US", enUS], ["es-MX", esMX]])("has every action, target and loss sentence in %s", (_locale, catalog) => {
        for (const key of keys) expect(typeof resolve(catalog, key), key).toBe("string");
    });

    it("has one sentence for each loss code the server can send", () => {
        expect(Object.keys(CONVERT_LOSS_KEYS).sort()).toEqual(
            Object.keys((enUS as { documents: { convert: { loss: object } } }).documents.convert.loss).sort(),
        );
    });
});

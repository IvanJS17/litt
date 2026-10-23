import { beforeEach, describe, expect, it, vi } from "vitest";

// Review access is not document access: a review in project Y can be built
// from project X's documents. The model (and the grid) must only see rows
// whose every source document the caller can read.

const mocks = vi.hoisted(() => ({ filterAccessibleDocumentIds: vi.fn() }));

vi.mock("../../access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../access")>()),
    filterAccessibleDocumentIds: mocks.filterAccessibleDocumentIds,
}));

import { filterReadableReviewRows, type ReviewRow } from "../tabular.rows";

function row(id: string, sourceIds: string[]): ReviewRow {
    return {
        id,
        review_id: "review-1",
        label: `${id}.pdf`,
        row_type: "document",
        folder_id: null,
        library_folder_id: null,
        document_id: sourceIds[0] ?? null,
        sort_index: 0,
        source_document_ids: sourceIds,
    };
}

const db = {} as never;

beforeEach(() => {
    vi.clearAllMocks();
});

describe("filterReadableReviewRows", () => {
    it("keeps only rows whose every source document the caller can read", async () => {
        mocks.filterAccessibleDocumentIds.mockResolvedValue(["doc-ok"]);

        const { rows, readableDocumentIds } = await filterReadableReviewRows(
            db,
            [row("row-ok", ["doc-ok"]), row("row-secret", ["doc-secret"])],
            [],
            "user-1",
            "user@example.test",
        );

        expect(rows.map((r) => r.id)).toEqual(["row-ok"]);
        expect([...readableDocumentIds]).toEqual(["doc-ok"]);
        expect(mocks.filterAccessibleDocumentIds).toHaveBeenCalledWith(
            ["doc-ok", "doc-secret"],
            "user-1",
            "user@example.test",
            db,
        );
    });

    it("drops a folder row when any one of its documents is unreadable", async () => {
        mocks.filterAccessibleDocumentIds.mockResolvedValue(["doc-1"]);

        const { rows } = await filterReadableReviewRows(
            db,
            [row("row-folder", ["doc-1", "doc-2"])],
            [],
            "user-1",
            "user@example.test",
        );

        expect(rows).toEqual([]);
    });

    it("checks the review's extra document ids with the same verdict", async () => {
        mocks.filterAccessibleDocumentIds.mockResolvedValue(["doc-1"]);

        const { readableDocumentIds } = await filterReadableReviewRows(
            db,
            [row("row-1", ["doc-1"])],
            ["doc-1", "doc-hidden"],
            "user-1",
            "user@example.test",
        );

        // Document metadata is filtered by the same call, so a review cannot
        // leak filenames it never puts in a row.
        expect(mocks.filterAccessibleDocumentIds).toHaveBeenCalledWith(
            ["doc-1", "doc-hidden"],
            "user-1",
            "user@example.test",
            db,
        );
        expect([...readableDocumentIds]).toEqual(["doc-1"]);
    });

    it("keeps a row with no resolved sources (vacuous verdict)", async () => {
        mocks.filterAccessibleDocumentIds.mockResolvedValue([]);

        const { rows } = await filterReadableReviewRows(
            db,
            [row("row-empty", [])],
            [],
            "user-1",
            "user@example.test",
        );

        expect(rows.map((r) => r.id)).toEqual(["row-empty"]);
    });
});

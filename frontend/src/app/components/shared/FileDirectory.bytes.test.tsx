import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "./types";
import { FileDirectory } from "./FileDirectory";

// The size column of the file picker, pinned before it shared one formatter.
describe("FileDirectory size column", () => {
    it("keeps showing bytes, kilobytes and megabytes, and nothing for an unknown size", () => {
        const sizes: [string, number | null][] = [
            ["a.pdf", 500],
            ["b.pdf", 1536],
            ["c.pdf", 5.5 * 1024 * 1024],
            ["d.pdf", null],
        ];
        const documents = sizes.map(([filename, size_bytes], index) => ({
            id: `document-${index}`,
            filename,
            file_type: "pdf",
            folder_id: null,
            size_bytes,
            created_at: "2026-08-03T00:00:00.000Z",
        })) as unknown as Document[];

        render(
            <FileDirectory
                documents={documents}
                folders={[]}
                selectedDocuments={[]}
                onChange={vi.fn()}
                showTabs={false}
            />,
        );

        expect(screen.getByText("500 B")).toBeInTheDocument();
        expect(screen.getByText("1.5 KB")).toBeInTheDocument();
        expect(screen.getByText("5.5 MB")).toBeInTheDocument();
        expect(screen.queryByText("null")).not.toBeInTheDocument();
    });
});

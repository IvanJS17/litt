import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelDocument } from "./types";
import { DocumentContent } from "./DocumentContent";

const mocks = vi.hoisted(() => ({
    getDocumentFile: vi.fn(),
    listDocumentVersions: vi.fn(),
    saveMarkdownVersion: vi.fn(),
}));

vi.mock("@/app/hooks/useTrainingVersionStatus", () => ({
    useTrainingVersionStatus: (_doc: string, versionId: string | null) => ({
        versionId,
        release: "released",
        canApprove: false,
        refresh: () => {},
    }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getDocumentFile: mocks.getDocumentFile,
    listDocumentVersions: mocks.listDocumentVersions,
    saveMarkdownVersion: mocks.saveMarkdownVersion,
}));

const document: PanelDocument = {
    document_id: "doc",
    title: "notes.md",
    type: "markdown",
    version_id: null,
    metadata: [],
    quotes: [],
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentFile.mockResolvedValue({
        blob: new Blob(["# Notas\n\n- uno\n- dos"], { type: "text/markdown" }),
        filename: "notes.md",
    });
    mocks.listDocumentVersions.mockResolvedValue({ current_version_id: "v2", versions: [] });
});

describe("DocumentContent with a .md", () => {
    it("shows the Markdown formatted, and read-only for someone who cannot upload versions", async () => {
        render(<DocumentContent document={document} mode={{ kind: "document" }} canEdit={false} />);
        expect(await screen.findByRole("heading", { name: "Notas" })).toBeVisible();
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
        expect(screen.queryByRole("img")).toBeNull();
    });

    it("lets an editor save, and tells the host which version was made", async () => {
        const saved = {
            id: "v3",
            version_number: 3,
            source: "user_edit",
            created_at: "2026-11-11T00:00:00Z",
            filename: "notes.md",
            file_type: "md" as const,
            size_bytes: 4,
        };
        mocks.saveMarkdownVersion.mockResolvedValue(saved);
        const onVersionChange = vi.fn();
        render(
            <DocumentContent
                document={document}
                mode={{ kind: "document" }}
                canEdit
                onVersionChange={onVersionChange}
            />,
        );
        // The title row's own Edit toggle is for Word; this one is the Markdown viewer's.
        fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
        fireEvent.click(screen.getByRole("button", { name: "Text" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown source" }), {
            target: { value: "# Nuevo" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(onVersionChange).toHaveBeenCalledWith(saved));
        expect(mocks.saveMarkdownVersion).toHaveBeenCalledWith("doc", "# Nuevo", "v2");
    });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "@/app/components/shared/types";
import { DocumentSidePanel } from "./DocumentSidePanel";

// Only whether the panel hands over `onSplit` matters here.
vi.mock("@/app/components/shared/ScanReadingStatus", () => ({
    ScanReadingStatus: ({ onSplit }: { onSplit?: () => void }) => (
        <p>{onSplit ? "can split" : "cannot split"}</p>
    ),
}));
vi.mock("@/app/components/shared/views/PdfView", () => ({ PdfView: () => null }));

const pdf: Document = {
    id: "doc-1",
    project_id: "project-1",
    filename: "case.pdf",
    file_type: "pdf",
    storage_path: "documents/case.pdf",
    pdf_storage_path: null,
    size_bytes: 1024,
    page_count: 3,
    structure_tree: null,
    status: "ready",
    created_at: "2026-09-27T00:00:00Z",
};

function renderPanel(doc: Document) {
    render(
        <DocumentSidePanel
            doc={doc}
            readOnly={false}
            versions={[]}
            versionsLoading={false}
            onClose={vi.fn()}
            onLoadVersions={vi.fn()}
            onSelectVersion={vi.fn()}
            onDownloadDocument={vi.fn()}
            onDownloadVersion={vi.fn()}
            onRenameVersion={vi.fn()}
            onDeleteVersion={vi.fn()}
            onUploadNewVersion={vi.fn()}
            onReplaceVersion={vi.fn()}
            onDelete={vi.fn()}
        />,
    );
}

describe("Separar expediente in the document panel", () => {
    it("is offered for a file, as the server accepts it", () => {
        renderPanel(pdf);
        expect(screen.getByText("can split")).toBeInTheDocument();
    });

    it("is not offered for a workflow's document or a library template", () => {
        renderPanel({ ...pdf, workflow_id: "wf-1", project_id: null });
        expect(screen.getByText("cannot split")).toBeInTheDocument();
    });

    it("is not offered for a library template either", () => {
        renderPanel({ ...pdf, library_kind: "template" });
        expect(screen.getByText("cannot split")).toBeInTheDocument();
    });
});

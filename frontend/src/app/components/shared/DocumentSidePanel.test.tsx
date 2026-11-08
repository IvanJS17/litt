import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { expect, it, vi } from "vitest";
import type { Document } from "@/app/components/shared/types";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { DocumentSidePanel } from "./DocumentSidePanel";

// Stand in for a viewer whose context menu portals to document.body.
vi.mock("@/app/components/shared/views/DocxView", () => ({
    DocxView: () =>
        createPortal(<button type="button">Viewer menu item</button>, document.body),
}));

const doc: Document = {
    id: "doc-1",
    project_id: "project-1",
    filename: "agreement.docx",
    file_type: "docx",
    storage_path: "documents/agreement.docx",
    pdf_storage_path: null,
    size_bytes: 1024,
    page_count: null,
    structure_tree: null,
    status: "ready",
    created_at: "2026-09-27T00:00:00Z",
};

function renderPanel(
    onClose = vi.fn(),
    options: { readOnly?: boolean; versions?: DocumentVersion[] } = {},
) {
    render(
        <DocumentSidePanel
            doc={doc}
            readOnly={options.readOnly ?? true}
            versions={options.versions ?? []}
            versionsLoading={false}
            onClose={onClose}
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
    return onClose;
}

it("stays open for portaled menus opened from the viewer, but closes on a real outside press", async () => {
    const onClose = renderPanel();
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Viewer menu item" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
});

it("titles the document view and lists the latest version first", () => {
    const version = (n: number, createdAt: string): DocumentVersion => ({
        id: `v${n}`,
        version_number: n,
        source: "upload",
        created_at: createdAt,
        filename: `agreement-v${n}.docx`,
    });
    renderPanel(vi.fn(), {
        readOnly: false,
        // Out of order on purpose: the list must not rely on the API's order.
        versions: [
            version(1, "2026-09-01T00:00:00Z"),
            version(3, "2026-09-02T00:00:00Z"),
            version(2, "2026-09-03T00:00:00Z"),
        ],
    });

    expect(
        screen.getByRole("heading", { name: "agreement-v3.docx" }),
    ).toBeInTheDocument();
    expect(
        screen
            .getAllByRole("button", { name: /^Download Version/ })
            .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
        "Download Version 3",
        "Download Version 2",
        "Download Version 1",
    ]);
});

it("marks a pasante draft, hides its downloads and lets an approver approve it", async () => {
    const approve = vi.spyOn(await import("@/app/lib/mikeApi"), "approveTrainingVersion");
    approve.mockResolvedValue({ document_version_id: "v2", content_sha256: "h", approved_at: "t" });
    const onTrainingApproved = vi.fn();
    const onDownloadVersion = vi.fn();
    const held: DocumentVersion = {
        id: "v2",
        version_number: 2,
        source: "upload",
        created_at: "2026-09-02T00:00:00Z",
        filename: "agreement-v2.docx",
        training_held: true,
        training_can_approve: true,
    };
    const released: DocumentVersion = { ...held, id: "v1", version_number: 1, filename: "agreement-v1.docx", training_held: false, training_can_approve: false };
    render(
        <DocumentSidePanel
            doc={doc}
            versions={[released, held]}
            versionsLoading={false}
            currentVersionId="v2"
            onClose={vi.fn()}
            onLoadVersions={vi.fn()}
            onSelectVersion={vi.fn()}
            onDownloadDocument={vi.fn()}
            onDownloadVersion={onDownloadVersion}
            onRenameVersion={vi.fn()}
            onDeleteVersion={vi.fn()}
            onUploadNewVersion={vi.fn()}
            onReplaceVersion={vi.fn()}
            onDelete={vi.fn()}
            onTrainingApproved={onTrainingApproved}
        />,
    );
    // The selected version's mark, and the one in its history row.
    expect(screen.getAllByText("Borrador de pasante, pendiente de aprobación")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Download V2" })).toBeNull();
    expect(screen.getByRole("button", { name: /Download/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar esta versión" }));
    await vi.waitFor(() => expect(onTrainingApproved).toHaveBeenCalledWith("doc-1"));
    expect(approve).toHaveBeenCalledWith("doc-1", "v2");
    approve.mockRestore();
});

it("speaks for the current version from the row before the versions load, and hides the read-only download", () => {
    render(
        <DocumentSidePanel
            doc={{ ...doc, training_held: true }}
            readOnly
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
    expect(screen.getByText("Borrador de pasante, pendiente de aprobación")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    // Nobody said this caller may approve.
    expect(screen.queryByRole("button", { name: "Aprobar esta versión" })).toBeNull();
});

it("offers the estimated authorship of the selected version only where the server said so", async () => {
    const authorship = vi.spyOn(await import("@/app/lib/mikeApi"), "getDocumentAuthorship");
    authorship.mockResolvedValue({
        document_id: "doc-1",
        version_id: "v2",
        status: "ok",
        estimate: true,
        baseline: "ai",
        words: { total: 10, person: 5, ai: 5, undetermined: 0 },
        shares: { person: 50, ai: 50, undetermined: 0 },
        edits: { accepted: 1, rejected: 0, pending: 0 },
        textless_pages: 0,
    });
    const version: DocumentVersion = {
        id: "v2",
        version_number: 2,
        source: "assistant_edit",
        created_at: "2026-09-02T00:00:00Z",
        filename: "agreement-v2.docx",
        training_authorship: true,
    };
    const props = {
        doc,
        versionsLoading: false,
        currentVersionId: "v2",
        onClose: vi.fn(),
        onLoadVersions: vi.fn(),
        onSelectVersion: vi.fn(),
        onDownloadDocument: vi.fn(),
        onDownloadVersion: vi.fn(),
        onRenameVersion: vi.fn(),
        onDeleteVersion: vi.fn(),
        onUploadNewVersion: vi.fn(),
        onReplaceVersion: vi.fn(),
        onDelete: vi.fn(),
    };
    const { unmount } = render(<DocumentSidePanel {...props} versions={[version]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show estimated authorship" }));
    await vi.waitFor(() => expect(authorship).toHaveBeenCalledWith("doc-1", "v2"));
    unmount();

    render(<DocumentSidePanel {...props} versions={[{ ...version, training_authorship: false }]} />);
    expect(screen.queryByRole("button", { name: "Show estimated authorship" })).toBeNull();
    authorship.mockRestore();
});

import { render, screen } from "@testing-library/react";

vi.mock("./DocumentAuthorshipPanel", () => ({
    DocumentAuthorshipPanel: ({ documentId, versionId }: { documentId: string; versionId: string | null }) => (
        <div data-testid="authorship">{`${documentId}:${versionId}`}</div>
    ),
}));
import { beforeEach, expect, it, vi } from "vitest";
import type { TrainingVersionStatus } from "@/app/hooks/useTrainingVersionStatus";

const status = vi.hoisted(() => ({ current: null as unknown as TrainingVersionStatus }));
const useTrainingVersionStatus = vi.hoisted(() => vi.fn(() => status.current));
vi.mock("@/app/hooks/useTrainingVersionStatus", () => ({ useTrainingVersionStatus }));

import { DocumentTitleRow } from "./DocumentTitleRow";
import type { PanelDocument } from "./types";

const doc = {
    document_id: "doc-1",
    version_id: "v2",
    title: "Agreement.docx",
    type: "docx",
    metadata: [],
    quotes: [],
} as unknown as PanelDocument;

const set = (release: TrainingVersionStatus["release"], canApprove = false, authorship = false) => {
    status.current = { versionId: "v2", release, canApprove, authorship, refresh: vi.fn() };
};

beforeEach(() => useTrainingVersionStatus.mockClear());

it("offers the download only once the version is known to be released", () => {
    set("unknown");
    const { rerender } = render(<DocumentTitleRow document={doc} isReloading={false} compactActions />);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryByText("Intern draft, pending approval")).toBeNull();
    expect(useTrainingVersionStatus).toHaveBeenCalledWith("doc-1", "v2", true);

    set("released");
    rerender(<DocumentTitleRow document={doc} isReloading={false} compactActions />);
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
});

it("marks a pasante draft, hides its download and shows Aprobar to an approver", () => {
    set("held", true);
    render(<DocumentTitleRow document={doc} isReloading={false} compactActions />);
    expect(screen.getByText("Intern draft, pending approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve this version" })).toBeInTheDocument();
});

it("asks nothing for a legal source", () => {
    set("released");
    render(
        <DocumentTitleRow
            document={{ ...doc, type: "case", version_id: null } as unknown as PanelDocument}
            isReloading={false}
            compactActions
        />,
    );
    expect(useTrainingVersionStatus).toHaveBeenCalledWith("doc-1", null, false);
});

it("reports the release to a host that offers its own download", () => {
    const onTrainingReleaseChange = vi.fn();
    set("held");
    const { rerender } = render(
        <DocumentTitleRow document={doc} isReloading={false} compactActions onTrainingReleaseChange={onTrainingReleaseChange} />,
    );
    expect(onTrainingReleaseChange).toHaveBeenLastCalledWith("held");
    set("released");
    rerender(
        <DocumentTitleRow document={doc} isReloading={false} compactActions onTrainingReleaseChange={onTrainingReleaseChange} />,
    );
    expect(onTrainingReleaseChange).toHaveBeenLastCalledWith("released");
});

it("offers the estimated authorship only where the server did", () => {
    set("held", true, true);
    const { rerender } = render(<DocumentTitleRow document={doc} isReloading={false} compactActions />);
    expect(screen.getByTestId("authorship")).toHaveTextContent("doc-1:v2");
    set("held", true, false);
    rerender(<DocumentTitleRow document={doc} isReloading={false} compactActions />);
    expect(screen.queryByTestId("authorship")).toBeNull();
});

it("offers no authorship for a legal source", () => {
    set("released", false, true);
    render(
        <DocumentTitleRow
            document={{ ...doc, type: "case", version_id: null } as unknown as PanelDocument}
            isReloading={false}
            compactActions
        />,
    );
    expect(screen.queryByTestId("authorship")).toBeNull();
});

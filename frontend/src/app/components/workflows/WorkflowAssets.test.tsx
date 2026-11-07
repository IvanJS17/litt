import { act, createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import type { Document } from "../shared/types";
import { WorkflowAssets, type WorkflowAssetsHandle } from "./WorkflowAssets";

const {
    copyDocumentsToWorkflowAssets,
    listWorkflowAssets,
    uploadWorkflowAssets,
} = vi.hoisted(() => ({
    copyDocumentsToWorkflowAssets: vi.fn(),
    listWorkflowAssets: vi.fn(),
    uploadWorkflowAssets: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/lib/mikeApi")>();
    return {
        ...actual,
        copyDocumentsToWorkflowAssets,
        listWorkflowAssets,
        uploadWorkflowAssets,
    };
});

vi.mock("../shared/DocumentSidePanel", () => ({
    DocumentSidePanel: ({ doc }: { doc: Document | null }) =>
        doc ? (
            <div data-testid="document-side-panel">{doc.filename}</div>
        ) : null,
}));

describe("WorkflowAssets", () => {
    afterEach(() => clearToasts());

    beforeEach(() => {
        clearToasts();
        vi.clearAllMocks();
        listWorkflowAssets.mockResolvedValue([
            {
                id: "reference-1",
                workflow_id: "workflow-1",
                filename: "Precedent.docx",
                file_type: "docx",
                size_bytes: 42,
                created_at: "2026-08-28T00:00:00.000Z",
                updated_at: "2026-08-28T00:00:00.000Z",
            },
        ]);
        copyDocumentsToWorkflowAssets.mockResolvedValue([
            {
                id: "asset-2",
                workflow_id: "workflow-1",
                filename: "Saved file.pdf",
                file_type: "pdf",
                size_bytes: 84,
                created_at: "2026-08-28T00:00:00.000Z",
                updated_at: "2026-08-28T00:00:00.000Z",
            },
        ]);
    });

    it("opens an asset in the document side panel when its row is clicked", async () => {
        const user = userEvent.setup();
        render(
            <WorkflowAssets workflowId="workflow-1" readOnly={false} />,
        );

        await waitFor(() =>
            expect(screen.getByText("Precedent.docx")).toBeVisible(),
        );
        await user.click(screen.getByText("Precedent.docx"));

        expect(screen.getByTestId("document-side-panel")).toHaveTextContent(
            "Precedent.docx",
        );
    });

    // LiTT training (W3): a pasante's copied draft is marked in its row.
    it("marks a held asset in plain text in its row", async () => {
        listWorkflowAssets.mockResolvedValue([
            {
                id: "reference-1",
                workflow_id: "workflow-1",
                filename: "Precedent.docx",
                file_type: "docx",
                size_bytes: 42,
                training_held: true,
                created_at: "2026-08-28T00:00:00.000Z",
                updated_at: "2026-08-28T00:00:00.000Z",
            },
        ]);
        render(<WorkflowAssets workflowId="workflow-1" readOnly={false} />);
        expect(
            await screen.findByText("Borrador de pasante, pendiente de aprobación"),
        ).toBeVisible();
    });

    it("copies selected saved documents into the workflow assets", async () => {
        const ref = createRef<WorkflowAssetsHandle>();
        render(
            <WorkflowAssets
                ref={ref}
                workflowId="workflow-1"
                readOnly={false}
            />,
        );
        await screen.findByText("Precedent.docx");

        act(() => {
            ref.current?.addSavedDocuments([
                { id: "saved-document-1" } as Document,
            ]);
        });

        await waitFor(() =>
            expect(copyDocumentsToWorkflowAssets).toHaveBeenCalledWith(
                "workflow-1",
                ["saved-document-1"],
            ),
        );
        expect(await screen.findByText("Saved file.pdf")).toBeVisible();
    });

    it("explains why a pasante's draft cannot be added to a personal workflow", async () => {
        // R1: a 409 with its own code, not "Unable to add saved files.".
        const { MikeApiError } = await import("@/app/lib/mikeApi");
        const detail =
            "Este archivo es un borrador de pasante y solo puede copiarse a un workflow de una organización, donde alguien pueda aprobarlo.";
        copyDocumentsToWorkflowAssets.mockRejectedValueOnce(
            new MikeApiError({
                message: detail,
                status: 409,
                code: "training_copy_needs_organization",
            }),
        );
        const ref = createRef<WorkflowAssetsHandle>();
        render(
            <WorkflowAssets ref={ref} workflowId="workflow-1" readOnly={false} />,
        );
        await screen.findByText("Precedent.docx");

        act(() => {
            ref.current?.addSavedDocuments([{ id: "draft-1" } as Document]);
        });

        expect(await screen.findByText(detail)).toBeVisible();
        expect(screen.queryByText("Unable to add saved files.")).toBeNull();
    });

    it("names the files an upload batch dropped and retries only those", async () => {
        const user = userEvent.setup();
        uploadWorkflowAssets.mockResolvedValue([
            {
                clientId: "c1",
                filename: "Good.pdf",
                status: "completed",
                result: {
                    id: "asset-3",
                    filename: "Good.pdf",
                    file_type: "pdf",
                    size_bytes: 1,
                    created_at: "2026-08-28T00:00:00.000Z",
                    updated_at: "2026-08-28T00:00:00.000Z",
                },
                errorCode: null,
            },
            {
                clientId: "c2",
                filename: "Bad.pdf",
                status: "error",
                result: null,
                errorCode: null,
            },
        ]);
        const ref = createRef<WorkflowAssetsHandle>();
        render(
            <>
                <WorkflowAssets
                    ref={ref}
                    workflowId="workflow-1"
                    readOnly={false}
                />
                <ToastViewportUI />
            </>,
        );
        await screen.findByText("Precedent.docx");

        act(() => {
            ref.current?.uploadFiles([
                new File(["a"], "Good.pdf", { type: "application/pdf" }),
                new File(["b"], "Bad.pdf", { type: "application/pdf" }),
            ]);
        });

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Couldn't upload 1 of 2 files");
        expect(alert).toHaveTextContent(
            "Bad.pdf could not be uploaded. Please try again.",
        );

        uploadWorkflowAssets.mockClear();
        uploadWorkflowAssets.mockResolvedValue([]);
        await user.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(uploadWorkflowAssets).toHaveBeenCalledWith("workflow-1", [
                { file: expect.objectContaining({ name: "Bad.pdf" }) },
            ]),
        );
    });

    it("reports a whole upload batch that never reached the server", async () => {
        uploadWorkflowAssets.mockRejectedValue(new TypeError("Failed to fetch"));
        const ref = createRef<WorkflowAssetsHandle>();
        render(
            <>
                <WorkflowAssets
                    ref={ref}
                    workflowId="workflow-1"
                    readOnly={false}
                />
                <ToastViewportUI />
            </>,
        );
        await screen.findByText("Precedent.docx");

        act(() => {
            ref.current?.uploadFiles([
                new File(["a"], "Dropped.pdf", { type: "application/pdf" }),
            ]);
        });

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Couldn't upload this file");
        expect(alert).not.toHaveTextContent("Failed to fetch");
    });
    it("retry does not resend the successful same-name file", async () => {
        const user = userEvent.setup();
        const good = new File(["good"], "Contract.pdf", { type: "application/pdf" });
        const bad = new File(["bad"], "Contract.pdf", { type: "application/pdf" });
        uploadWorkflowAssets.mockResolvedValueOnce([
          {clientId: "1", filename: good.name, status: "completed", result: {id: "landed", filename: good.name}, errorCode: null},
          {clientId: "2", filename: bad.name, status: "error", result: null, errorCode: null},
        ]).mockResolvedValue([]);
        const ref = createRef<WorkflowAssetsHandle>();
        render(<><WorkflowAssets ref={ref} workflowId="workflow-1" readOnly={false}/><ToastViewportUI/></>);
        await screen.findByText("Precedent.docx");
        act(() => { ref.current?.uploadFiles([good,bad]); });
        await screen.findByRole("alert");
        await user.click(screen.getByRole("button", {name: "Retry"}));
        await waitFor(() => expect(uploadWorkflowAssets).toHaveBeenCalledTimes(2));
        expect(uploadWorkflowAssets.mock.calls[1][1]).toHaveLength(1);
        expect(uploadWorkflowAssets.mock.calls[1][1][0].file).toBe(bad);
    });

});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getTokenDownload: vi.fn(),
    downloadBlob: vi.fn(),
    notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", () => ({ getTokenDownload: mocks.getTokenDownload }));
vi.mock("@/app/lib/downloadDocument", () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notifyError }));

import { TRAINING_HELD_LABEL } from "@mike/ui";
import { DocDownloadBlock } from "./EventBlocks";

beforeEach(() => vi.clearAllMocks());

describe("DocDownloadBlock and the training lock (docs/training.md)", () => {
    it("keeps a pasante draft openable, marked, and without a download", () => {
        const onOpen = vi.fn();
        render(
            <DocDownloadBlock filename="draft.docx" download_url="/download/t" trainingHeld onOpen={onOpen} />,
        );
        expect(screen.getByText(TRAINING_HELD_LABEL)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Download draft.docx" })).toBeNull();
        fireEvent.click(screen.getByRole("button"));
        expect(onOpen).toHaveBeenCalledOnce();
        expect(mocks.getTokenDownload).not.toHaveBeenCalled();
    });

    it("offers nothing to click for a held draft it cannot open", () => {
        render(<DocDownloadBlock filename="draft.docx" download_url="/download/t" trainingHeld />);
        expect(screen.getByText(TRAINING_HELD_LABEL)).toBeInTheDocument();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("downloads a released document and reports a refusal through notifyError", async () => {
        const blob = new Blob(["x"]);
        mocks.getTokenDownload.mockResolvedValueOnce({ blob, filename: null });
        render(<DocDownloadBlock filename="memo.docx" download_url="/download/t" />);
        const button = screen.getByRole("button", { name: "Download memo.docx" });
        fireEvent.click(button);
        await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(blob, "memo.docx"));
        expect(mocks.getTokenDownload).toHaveBeenCalledWith("/download/t");

        const refusal = Object.assign(new Error("Esta versión es un borrador de pasante"), {
            status: 409,
            code: "training_approval_required",
        });
        mocks.getTokenDownload.mockRejectedValueOnce(refusal);
        fireEvent.click(await screen.findByRole("button", { name: "Download memo.docx" }));
        await waitFor(() =>
            expect(mocks.notifyError).toHaveBeenCalledWith(refusal, { action: "download this document" }),
        );
    });
});

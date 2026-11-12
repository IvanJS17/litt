import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompareDocumentModal } from "./CompareDocumentModal";

const mocks = vi.hoisted(() => ({ compare: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({ compareDocuments: mocks.compare }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notify }));

const CREATED = { document_id: "new", version_id: "v", filename: "A vs B (changes).docx", file_type: "docx", size_bytes: 3, project_id: "p", folder_id: null };
const request = { documentId: "doc-1", filename: "Contrato.docx" };
const candidates = [
    { id: "doc-2", filename: "Contrato negociado.docx" },
    { id: "doc-3", filename: "Otro.docx" },
];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.compare.mockResolvedValue(CREATED);
});

describe("CompareDocumentModal", () => {
    it("is closed with no request", () => {
        render(<CompareDocumentModal request={null} candidates={candidates} onClose={vi.fn()} onCompared={vi.fn()} />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("lists the candidates, explains the result, and compares nothing until confirmed", async () => {
        render(<CompareDocumentModal request={request} candidates={candidates} onClose={vi.fn()} onCompared={vi.fn()} />);
        expect(screen.getByText(/Compare “Contrato.docx” \(the original\)/)).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Contrato negociado.docx" })).not.toBeChecked();
        expect(screen.getByText("A new Word document is created with the differences as tracked changes.")).toBeInTheDocument();
        expect(screen.getByText(/clauses that were moved may show as deleted and written again/)).toBeInTheDocument();
        expect(screen.getByText("Your original documents don’t change.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Compare and create document" })).toBeDisabled();
        expect(mocks.compare).not.toHaveBeenCalled();
    });

    it("creates nothing when cancelled", async () => {
        const onClose = vi.fn();
        const onCompared = vi.fn();
        render(<CompareDocumentModal request={request} candidates={candidates} onClose={onClose} onCompared={onCompared} />);
        await userEvent.click(screen.getByRole("radio", { name: "Otro.docx" }));
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.compare).not.toHaveBeenCalled();
        expect(onCompared).not.toHaveBeenCalled();
    });

    it("compares the chosen file against the document and hands the new document over", async () => {
        const onCompared = vi.fn();
        render(<CompareDocumentModal request={request} candidates={candidates} onClose={vi.fn()} onCompared={onCompared} />);
        await userEvent.click(screen.getByRole("radio", { name: "Contrato negociado.docx" }));
        await userEvent.click(screen.getByRole("button", { name: "Compare and create document" }));
        await waitFor(() => expect(onCompared).toHaveBeenCalledWith(CREATED));
        expect(mocks.compare).toHaveBeenCalledWith("doc-1", "doc-2");
    });

    it("stays open and reports a failure, offering a retry", async () => {
        mocks.compare.mockRejectedValueOnce(new Error("boom"));
        const onCompared = vi.fn();
        render(<CompareDocumentModal request={request} candidates={candidates} onClose={vi.fn()} onCompared={onCompared} />);
        await userEvent.click(screen.getByRole("radio", { name: "Otro.docx" }));
        await userEvent.click(screen.getByRole("button", { name: "Compare and create document" }));
        await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
        expect(mocks.notify.mock.calls[0][1]).toMatchObject({ action: "compare these documents" });
        expect(onCompared).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Compare and create document" })).toBeEnabled();
        mocks.notify.mock.calls[0][1].onRetry();
        await waitFor(() => expect(onCompared).toHaveBeenCalledWith(CREATED));
    });

    it("does not close or compare twice while comparing", async () => {
        let resolve!: (value: typeof CREATED) => void;
        mocks.compare.mockReturnValue(new Promise((r) => (resolve = r)));
        const onClose = vi.fn();
        const onCompared = vi.fn();
        render(<CompareDocumentModal request={request} candidates={candidates} onClose={onClose} onCompared={onCompared} />);
        await userEvent.click(screen.getByRole("radio", { name: "Otro.docx" }));
        await userEvent.click(screen.getByRole("button", { name: "Compare and create document" }));
        expect(await screen.findByRole("button", { name: "Comparing…" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
        expect(mocks.compare).toHaveBeenCalledTimes(1);
        resolve(CREATED);
        await waitFor(() => expect(onCompared).toHaveBeenCalledTimes(1));
    });

    it("ignores a result that arrives after the dialog was dismissed", async () => {
        let resolve!: (value: typeof CREATED) => void;
        mocks.compare.mockReturnValue(new Promise((r) => (resolve = r)));
        const onCompared = vi.fn();
        const { rerender } = render(<CompareDocumentModal request={request} candidates={candidates} onClose={vi.fn()} onCompared={onCompared} />);
        await userEvent.click(screen.getByRole("radio", { name: "Otro.docx" }));
        await userEvent.click(screen.getByRole("button", { name: "Compare and create document" }));
        rerender(<CompareDocumentModal request={null} candidates={candidates} onClose={vi.fn()} onCompared={onCompared} />);
        resolve(CREATED);
        await Promise.resolve();
        expect(onCompared).not.toHaveBeenCalled();
    });

    it("ignores a failure that arrives after the dialog was dismissed", async () => {
        let reject!: (error: Error) => void;
        mocks.compare.mockReturnValue(new Promise((_r, j) => (reject = j)));
        const { rerender } = render(<CompareDocumentModal request={request} candidates={candidates} onClose={vi.fn()} onCompared={vi.fn()} />);
        await userEvent.click(screen.getByRole("radio", { name: "Otro.docx" }));
        await userEvent.click(screen.getByRole("button", { name: "Compare and create document" }));
        rerender(<CompareDocumentModal request={null} candidates={candidates} onClose={vi.fn()} onCompared={vi.fn()} />);
        reject(new Error("late"));
        await Promise.resolve();
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it("says so when the project has no other Word file, and cannot compare", () => {
        render(<CompareDocumentModal request={request} candidates={[]} onClose={vi.fn()} onCompared={vi.fn()} />);
        expect(screen.getByRole("status")).toHaveTextContent("There is no other Word file in this project to compare with.");
        expect(screen.getByRole("button", { name: "Compare and create document" })).toBeDisabled();
    });
});

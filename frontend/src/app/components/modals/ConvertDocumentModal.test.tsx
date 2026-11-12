import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentConversionPreview } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ConvertDocumentModal } from "./ConvertDocumentModal";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), convert: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({
    previewDocumentConversion: mocks.preview,
    convertDocument: mocks.convert,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notify }));

const WORD_TO_MD: DocumentConversionPreview = {
    source_type: "docx",
    target: "md",
    losses: ["docx_comments", "docx_tracked_changes", "docx_images", "docx_formatting"],
    detected: { comments: 12, tracked_insertions: 3, tracked_deletions: 2, images: 2, footnotes: 0, headers: 0, footers: 1 },
    blocked: null,
    textless_page_count: null,
    new_filename: "Contrato (de Word).md",
};
const CREATED = { document_id: "new", version_id: "v", filename: "Contrato (de Word).md", file_type: "md", size_bytes: 3, project_id: "p", folder_id: null };
const request = { documentId: "doc-1", filename: "Contrato.docx", target: "md" as const };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mockResolvedValue(WORD_TO_MD);
    mocks.convert.mockResolvedValue(CREATED);
});

describe("ConvertDocumentModal", () => {
    it("is closed with no request and asks nothing", () => {
        render(<ConvertDocumentModal request={null} onClose={vi.fn()} onConverted={vi.fn()} />);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(mocks.preview).not.toHaveBeenCalled();
    });

    it("says what this document loses and that the original stays, before converting anything", async () => {
        render(<ConvertDocumentModal request={request} onClose={vi.fn()} onConverted={vi.fn()} />);
        expect(screen.getByRole("status")).toHaveTextContent("Checking what this conversion would lose…");
        expect(screen.getByRole("button", { name: "Convert and create new document" })).toBeDisabled();

        expect(await screen.findByText("12 comments won’t carry over.")).toBeInTheDocument();
        expect(screen.getByText("5 tracked changes: only the final text carries over.")).toBeInTheDocument();
        expect(screen.getByText("2 images become “[img]”.")).toBeInTheDocument();
        expect(screen.getByText("1 header or footer won’t carry over.")).toBeInTheDocument();
        // Nothing was counted for footnotes: no line.
        expect(screen.queryByText(/footnote/)).toBeNull();
        // The fixed list of this conversion.
        expect(screen.getByText("Comments don’t carry over.")).toBeInTheDocument();
        expect(screen.getByText("Fine formatting is lost: indents, colors and fonts.")).toBeInTheDocument();
        expect(screen.getByText("Your original document doesn’t change.")).toBeInTheDocument();
        expect(screen.getByText("The new document will be named “Contrato (de Word).md”.")).toBeInTheDocument();
        expect(screen.getByText("Convert “Contrato.docx” to Markdown.")).toBeInTheDocument();
        expect(mocks.preview).toHaveBeenCalledWith("doc-1", "md");
        expect(mocks.convert).not.toHaveBeenCalled();
    });

    it("creates nothing when cancelled", async () => {
        const onClose = vi.fn();
        const onConverted = vi.fn();
        render(<ConvertDocumentModal request={request} onClose={onClose} onConverted={onConverted} />);
        await screen.findByText("Your original document doesn’t change.");
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.convert).not.toHaveBeenCalled();
        expect(onConverted).not.toHaveBeenCalled();
    });

    it("converts on confirmation and hands over the new document", async () => {
        const onConverted = vi.fn();
        render(<ConvertDocumentModal request={request} onClose={vi.fn()} onConverted={onConverted} />);
        await screen.findByText("Your original document doesn’t change.");
        await userEvent.click(screen.getByRole("button", { name: "Convert and create new document" }));
        await waitFor(() => expect(onConverted).toHaveBeenCalledWith(CREATED));
        expect(mocks.convert).toHaveBeenCalledTimes(1);
        expect(mocks.convert).toHaveBeenCalledWith("doc-1", "md");
    });

    it("disables both buttons while converting, and cannot be closed by the backdrop", async () => {
        let finish: (value: typeof CREATED) => void = () => {};
        mocks.convert.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const onClose = vi.fn();
        render(<ConvertDocumentModal request={request} onClose={onClose} onConverted={vi.fn()} />);
        await screen.findByText("Your original document doesn’t change.");
        await userEvent.click(screen.getByRole("button", { name: "Convert and create new document" }));
        expect(screen.getByRole("button", { name: "Converting…" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
        await userEvent.keyboard("{Escape}");
        expect(onClose).not.toHaveBeenCalled();
        finish(CREATED);
    });

    it("reports a failed conversion with a retry and stays open", async () => {
        const failure = new Error("boom");
        mocks.convert.mockRejectedValueOnce(failure);
        const onConverted = vi.fn();
        const onClose = vi.fn();
        render(<ConvertDocumentModal request={request} onClose={onClose} onConverted={onConverted} />);
        await screen.findByText("Your original document doesn’t change.");
        await userEvent.click(screen.getByRole("button", { name: "Convert and create new document" }));
        await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
        const [error, options] = mocks.notify.mock.calls[0];
        expect(error).toBe(failure);
        expect(options.action).toBe("convert this document");
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Convert and create new document" })).toBeEnabled();
        // The retry runs the same conversion again.
        await options.onRetry();
        expect(mocks.convert).toHaveBeenCalledTimes(2);
        expect(onConverted).toHaveBeenCalledWith(CREATED);
    });

    it("closes with an error notice when the notice cannot be fetched, with no retry that would do nothing", async () => {
        const failure = new Error("403");
        mocks.preview.mockRejectedValueOnce(failure);
        const onClose = vi.fn();
        render(<ConvertDocumentModal request={request} onClose={onClose} onConverted={vi.fn()} />);
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const [error, options] = mocks.notify.mock.calls[0];
        expect(error).toBe(failure);
        expect(options.action).toBe("check what this conversion would lose");
        expect(options.onRetry).toBeUndefined();
    });

    it("says how many pages of a mixed PDF have no text and keeps the conversion available", async () => {
        mocks.preview.mockResolvedValue({ ...WORD_TO_MD, source_type: "pdf", detected: null, losses: ["pdf_layout_lost"], textless_page_count: 3 });
        render(<ConvertDocumentModal request={{ ...request, filename: "Mixto.pdf" }} onClose={vi.fn()} onConverted={vi.fn()} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("3 pages have no text and won’t carry over.");
        expect(screen.getByRole("button", { name: "Convert and create new document" })).toBeEnabled();
    });

    it("says it in the singular for one page", async () => {
        mocks.preview.mockResolvedValue({ ...WORD_TO_MD, source_type: "pdf", detected: null, losses: ["pdf_layout_lost"], textless_page_count: 1 });
        render(<ConvertDocumentModal request={{ ...request, filename: "Mixto.pdf" }} onClose={vi.fn()} onConverted={vi.fn()} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("1 page has no text and won’t carry over.");
    });

    it("does not offer to convert a PDF with no text, and says why", async () => {
        mocks.preview.mockResolvedValue({ ...WORD_TO_MD, source_type: "pdf", detected: null, losses: ["pdf_layout_lost"], blocked: "pdf_without_text" });
        render(<ConvertDocumentModal request={{ ...request, filename: "Escaneo.pdf" }} onClose={vi.fn()} onConverted={vi.fn()} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("This PDF has no text layer, so it needs OCR before it can be converted.");
        expect(screen.getByRole("button", { name: "Convert and create new document" })).toBeDisabled();
        await userEvent.click(screen.getByRole("button", { name: "Convert and create new document" }));
        expect(mocks.convert).not.toHaveBeenCalled();
    });

    it("shows no per-document counts for a Markdown source", async () => {
        mocks.preview.mockResolvedValue({ ...WORD_TO_MD, source_type: "md", target: "docx", detected: null, losses: ["md_raw_html", "md_formulas", "md_house_style"] });
        render(<ConvertDocumentModal request={{ documentId: "d", filename: "Notas.md", target: "docx" }} onClose={vi.fn()} onConverted={vi.fn()} />);
        await screen.findByText("Raw HTML in the Markdown is ignored.");
        expect(screen.queryByText("In this document")).toBeNull();
        expect(screen.getByText("Convert “Notas.md” to Word.")).toBeInTheDocument();
    });

    it("ignores a notice that arrives after the dialog closed, and a conversion that finishes after it", async () => {
        let resolvePreview: (value: DocumentConversionPreview) => void = () => {};
        mocks.preview.mockReturnValue(new Promise((resolve) => (resolvePreview = resolve)));
        const { unmount } = render(<ConvertDocumentModal request={request} onClose={vi.fn()} onConverted={vi.fn()} />);
        unmount();
        resolvePreview(WORD_TO_MD);
        await Promise.resolve();

        mocks.preview.mockResolvedValue(WORD_TO_MD);
        const onConverted = vi.fn();
        let finish: (value: typeof CREATED) => void = () => {};
        mocks.convert.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const second = render(<ConvertDocumentModal request={request} onClose={vi.fn()} onConverted={onConverted} />);
        await screen.findByText("Your original document doesn’t change.");
        await userEvent.click(screen.getByRole("button", { name: "Convert and create new document" }));
        second.unmount();
        finish(CREATED);
        await Promise.resolve();
        expect(onConverted).not.toHaveBeenCalled();
        // And a failure after the close is not reported over whatever the person is doing now.
        let fail: (error: Error) => void = () => {};
        mocks.convert.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
        const third = render(<ConvertDocumentModal request={request} onClose={vi.fn()} onConverted={onConverted} />);
        await screen.findByText("Your original document doesn’t change.");
        await userEvent.click(screen.getByRole("button", { name: "Convert and create new document" }));
        third.unmount();
        fail(new Error("late"));
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it("speaks Spanish for a person who uses es-MX", async () => {
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <ConvertDocumentModal request={request} onClose={vi.fn()} onConverted={vi.fn()} />
            </IntlClientProvider>,
        );
        expect(await screen.findByText("12 comentarios no pasarán.")).toBeInTheDocument();
        expect(screen.getByText("5 cambios marcados: solo pasa el texto final.")).toBeInTheDocument();
        expect(screen.getByText("Tu documento original no cambia.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Convertir y crear documento nuevo" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    });
});

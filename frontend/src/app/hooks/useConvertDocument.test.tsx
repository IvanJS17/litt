import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { DocumentConversionResult } from "@mike/contracts";
import { useConvertDocument } from "./useConvertDocument";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), convert: vi.fn(), toast: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({ previewDocumentConversion: mocks.preview, convertDocument: mocks.convert }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notify }));
vi.mock("@/app/components/ui/toast", () => ({ showToast: mocks.toast }));

const CREATED = { document_id: "new", version_id: "v", filename: "Notas (de Markdown).docx", file_type: "docx", size_bytes: 3, project_id: "p", folder_id: null };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mockResolvedValue({ source_type: "md", target: "docx", losses: ["md_raw_html"], detected: null, blocked: null, textless_page_count: null, new_filename: CREATED.filename });
    mocks.convert.mockResolvedValue(CREATED);
});

function Harness({ onConverted }: { onConverted: (result: DocumentConversionResult) => void }) {
    const { start, modal } = useConvertDocument({ onConverted });
    return (
        <>
            <button type="button" onClick={() => start({ id: "doc-1", filename: "Notas.md" }, "docx")}>
                Start
            </button>
            {modal}
        </>
    );
}

it("opens the notice for the chosen document and creates nothing until confirmed", async () => {
    const onConverted = vi.fn();
    render(<Harness onConverted={onConverted} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Convert “Notas.md” to Word.")).toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledWith("doc-1", "docx");
    expect(mocks.convert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(onConverted).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
});

it("converts on confirmation, closes, tells the person and hands the new document over", async () => {
    const onConverted = vi.fn();
    render(<Harness onConverted={onConverted} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(await screen.findByRole("button", { name: "Convert and create new document" }));
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith(CREATED));
    expect(mocks.convert).toHaveBeenCalledWith("doc-1", "docx");
    expect(mocks.toast).toHaveBeenCalledWith({ tone: "success", message: "Created “Notas (de Markdown).docx”." });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

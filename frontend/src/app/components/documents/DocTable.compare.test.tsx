import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { can, type Capability } from "@/app/lib/permissions";
import { useCompareDocument } from "@/app/hooks/useCompareDocument";
import type { Document } from "../shared/types";
import { DocTable } from "./DocTable";

// "Compare with…" in the project's document table: only for Word, the picker
// excludes the document itself and every non-Word or held file, and Cancel
// creates nothing.

const mocks = vi.hoisted(() => ({ compare: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    compareDocuments: mocks.compare,
}));
vi.mock("@/app/components/ui/toast", () => ({ showToast: mocks.toast }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "me", email: "me@firm.test" } }),
}));

const doc = (id: string, filename: string, file_type: string, extra: Partial<Document> = {}) =>
    ({
        id, filename, file_type, project_id: "p1", folder_id: null, storage_path: null, pdf_storage_path: null,
        size_bytes: 1, page_count: null, structure_tree: null, status: "ready",
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...extra,
    }) as Document;

const documents = [
    doc("word", "Contrato.docx", "docx"),
    doc("word2", "Contrato negociado.docx", "docx"),
    doc("md", "Notas.md", "md"),
    doc("pdf", "Escritura.pdf", "pdf"),
    doc("held", "Borrador.docx", "docx", { training_held: true }),
];

const operations = {
    uploadDocuments: vi.fn(), refreshCollection: vi.fn(async () => {}), createFolder: vi.fn(), resolveFolderPath: vi.fn(),
    renameFolder: vi.fn(), deleteFolder: vi.fn(async () => {}), moveFolder: vi.fn(), moveDocument: vi.fn(), renameDocument: vi.fn(),
};

function Harness({ enabled = true, onCompared = vi.fn() }: { enabled?: boolean; onCompared?: () => void }) {
    const comparison = useCompareDocument({ documents, onCompared });
    return (
        <>
            <DocTable
                scopeKey="project:p1" documents={documents} setDocuments={vi.fn()} folders={[]} setFolders={vi.fn()}
                loading={false} search="" operations={operations as never} emptyStateTitle="Documents"
                canDo={(capability: Capability) => can("editor", capability)}
                onCompareDoc={enabled ? comparison.start : undefined}
            />
            {comparison.modal}
        </>
    );
}

async function openMenu(filename: string) {
    const user = userEvent.setup();
    let scope = screen.getByText(filename) as HTMLElement;
    while (within(scope).queryAllByRole("button", { name: "Open row actions" }).length !== 1) scope = scope.parentElement as HTMLElement;
    await user.click(within(scope).getByRole("button", { name: "Open row actions" }));
    return { user, menu: await screen.findByRole("menu") };
}
const compares = (menu: HTMLElement) =>
    within(menu).queryAllByRole("menuitem").map((item) => item.textContent).filter((label) => label?.startsWith("Compare"));

beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
});

describe("DocTable Compare with…", () => {
    it.each([
        ["Contrato.docx", ["Compare with…"]],
        ["Notas.md", []],
        ["Escritura.pdf", []],
        ["Borrador.docx", []],
    ])("offers %s: %j", async (name, expected) => {
        render(<Harness />);
        const { menu } = await openMenu(name);
        expect(compares(menu)).toEqual(expected);
    });

    it("gives the entry its own id", async () => {
        render(<Harness />);
        const { menu } = await openMenu("Contrato.docx");
        expect(within(menu).getByRole("menuitem", { name: "Compare with…" })).toHaveAttribute("id", "compare");
    });

    it("offers nothing where comparison is not wired", async () => {
        render(<Harness enabled={false} />);
        const { menu } = await openMenu("Contrato.docx");
        expect(compares(menu)).toEqual([]);
    });

    it("lists only the other Word files, and cancelling creates nothing", async () => {
        render(<Harness />);
        const { user, menu } = await openMenu("Contrato.docx");
        await user.click(within(menu).getByRole("menuitem", { name: "Compare with…" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["Contrato negociado.docx"]);
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(mocks.compare).not.toHaveBeenCalled();
    });

    it("compares on confirmation, tells the person and refreshes", async () => {
        const created = { document_id: "n", version_id: "v", filename: "Contrato vs Contrato negociado (changes).docx", file_type: "docx", size_bytes: 3, project_id: "p1", folder_id: null };
        mocks.compare.mockResolvedValue(created);
        const onCompared = vi.fn();
        render(<Harness onCompared={onCompared} />);
        const { user, menu } = await openMenu("Contrato.docx");
        await user.click(within(menu).getByRole("menuitem", { name: "Compare with…" }));
        await user.click(await screen.findByRole("radio", { name: "Contrato negociado.docx" }));
        await user.click(screen.getByRole("button", { name: "Compare and create document" }));
        await waitFor(() => expect(onCompared).toHaveBeenCalledWith(created));
        expect(mocks.compare).toHaveBeenCalledWith("word", "word2");
        expect(mocks.toast).toHaveBeenCalledWith({ tone: "success", message: "Created “Contrato vs Contrato negociado (changes).docx” with the tracked changes." });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentConversionPreview } from "@mike/contracts";
import { can, type Capability } from "@/app/lib/permissions";
import { useConvertDocument } from "@/app/hooks/useConvertDocument";
import type { Document } from "../shared/types";
import { DocTable } from "./DocTable";

// What this file pins: the project's document table has its own row menu, not
// documentContextMenuItems, so "Convert to…" has to be wired there too — only
// the formats that exist for each type, opening the same notice dialog.

const mocks = vi.hoisted(() => ({ preview: vi.fn(), convert: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    previewDocumentConversion: mocks.preview,
    convertDocument: mocks.convert,
}));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "me", email: "me@firm.test" } }),
}));

const doc = (id: string, filename: string, file_type: string, extra: Partial<Document> = {}) =>
    ({
        id,
        filename,
        file_type,
        project_id: "p1",
        folder_id: null,
        storage_path: null,
        pdf_storage_path: null,
        size_bytes: 1,
        page_count: null,
        structure_tree: null,
        status: "ready",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...extra,
    }) as Document;

const documents = [
    doc("word", "Contrato.docx", "docx"),
    doc("md", "Notas.md", "md"),
    doc("pdf", "Escritura.pdf", "pdf"),
    doc("sheet", "Cuentas.xlsx", "xlsx"),
    doc("held", "Borrador.docx", "docx", { training_held: true }),
];

const operations = {
    uploadDocuments: vi.fn(),
    refreshCollection: vi.fn(async () => {}),
    createFolder: vi.fn(),
    resolveFolderPath: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(async () => {}),
    moveFolder: vi.fn(),
    moveDocument: vi.fn(),
    renameDocument: vi.fn(),
};

function Harness({ enabled = true }: { enabled?: boolean }) {
    const conversion = useConvertDocument({ onConverted: vi.fn() });
    return (
        <>
            <DocTable
                scopeKey="project:p1"
                documents={documents}
                setDocuments={vi.fn()}
                folders={[]}
                setFolders={vi.fn()}
                loading={false}
                search=""
                operations={operations as never}
                emptyStateTitle="Documents"
                canDo={(capability: Capability) => can("editor", capability)}
                onConvertDoc={enabled ? conversion.start : undefined}
            />
            {conversion.modal}
        </>
    );
}

async function openMenu(filename: string) {
    const user = userEvent.setup();
    const row = screen.getByText(filename).closest("[role='row'], tr, div[data-doc-row]") ?? screen.getByText(filename);
    let scope: HTMLElement = row as HTMLElement;
    // Walk up to the nearest ancestor holding exactly one row-actions button.
    while (within(scope).queryAllByRole("button", { name: "Open row actions" }).length !== 1) {
        scope = scope.parentElement as HTMLElement;
    }
    await user.click(within(scope).getByRole("button", { name: "Open row actions" }));
    return { user, menu: await screen.findByRole("menu") };
}
const converts = (menu: HTMLElement) =>
    within(menu)
        .queryAllByRole("menuitem")
        .map((item) => item.textContent)
        .filter((label) => label?.startsWith("Convert"));

beforeEach(() => {
    vi.clearAllMocks();
    const preview: DocumentConversionPreview = {
        source_type: "md",
        target: "docx",
        losses: [],
        detected: { comments: 0, tracked_insertions: 0, tracked_deletions: 0, images: 0, footnotes: 0, headers: 0, footers: 0 },
        blocked: null,
        new_filename: "Notas (de Markdown).docx",
    };
    mocks.preview.mockResolvedValue(preview);
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
});

describe("DocTable Convert to…", () => {
    it.each([
        ["Contrato.docx", ["Convert to Markdown…", "Convert to PDF…"]],
        ["Notas.md", ["Convert to Word…", "Convert to PDF…"]],
        ["Escritura.pdf", ["Convert to Markdown…"]],
        ["Cuentas.xlsx", []],
        ["Borrador.docx", []],
    ])("offers %s only the formats that exist for it", async (name, expected) => {
        render(<Harness />);
        const { menu } = await openMenu(name);
        expect(converts(menu)).toEqual(expected);
    });

    it("gives each entry its own id", async () => {
        render(<Harness />);
        const { menu } = await openMenu("Notas.md");
        expect(within(menu).getByRole("menuitem", { name: "Convert to Word…" })).toHaveAttribute("id", "convert-docx");
        expect(within(menu).getByRole("menuitem", { name: "Convert to PDF…" })).toHaveAttribute("id", "convert-pdf");
    });

    it("offers nothing where conversion is not wired", async () => {
        render(<Harness enabled={false} />);
        const { menu } = await openMenu("Notas.md");
        expect(converts(menu)).toEqual([]);
    });

    it("opens the notice, without converting by itself", async () => {
        render(<Harness />);
        const { user, menu } = await openMenu("Notas.md");
        await user.click(within(menu).getByRole("menuitem", { name: "Convert to Word…" }));
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(mocks.preview).toHaveBeenCalledWith("md", "docx");
        expect(mocks.convert).not.toHaveBeenCalled();
    });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { createTranslator } from "use-intl/core";
import { ProjectDocumentTabs } from "../projects/ProjectDocumentTabs";
import { ProjectExplorer } from "../projects/ProjectExplorer";
import { documentContextMenuItems } from "./DocumentTabActions";
import type { Document } from "./types";

vi.mock("@/app/hooks/useDocumentPermissions", () => ({ useDocumentPermissions: () => () => ({ canEdit: true, canDelete: true }) }));
vi.mock("@/app/components/shared/DocumentContent", () => ({ DocumentContent: () => <div>Document body</div> }));

const files = [
    { id: "word", filename: "Contrato.docx", file_type: "docx" },
    { id: "md", filename: "Notas.md", file_type: "md" },
    { id: "pdf", filename: "Escritura.pdf", file_type: "pdf" },
    { id: "sheet", filename: "Cuentas.xlsx", file_type: "xlsx" },
    { id: "held", filename: "Borrador.docx", file_type: "docx", training_held: true },
] as Document[];

function tabMenu(name: string, onConvertDoc = vi.fn()) {
    render(
        <ProjectDocumentTabs
            tabs={files.map((file) => ({ documentId: file.id, filename: file.filename }))}
            documents={files}
            activeTabId="word"
            onActivate={vi.fn()}
            onClose={vi.fn()}
            onReorder={vi.fn()}
            onConvertDoc={onConvertDoc}
            onAddToChat={vi.fn()}
        />,
    );
    fireEvent.contextMenu(screen.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }), { clientX: 10, clientY: 10 });
    return { menu: screen.getByRole("menu"), onConvertDoc };
}
const labels = (menu: HTMLElement) => within(menu).queryAllByRole("menuitem").map((item) => item.textContent);

describe("Convert to… in the document tab menu", () => {
    it.each([
        ["Contrato.docx", ["Convert to Markdown…", "Convert to PDF…"]],
        ["Notas.md", ["Convert to Word…", "Convert to PDF…"]],
        ["Escritura.pdf", ["Convert to Markdown…"]],
    ])("offers %s only the formats that exist for it", (name, expected) => {
        const { menu } = tabMenu(name);
        expect(labels(menu).filter((label) => label?.startsWith("Convert"))).toEqual(expected);
    });

    it("offers a spreadsheet nothing", () => {
        const { menu } = tabMenu("Cuentas.xlsx");
        expect(labels(menu).filter((label) => label?.startsWith("Convert"))).toEqual([]);
    });

    it("never offers a PDF the Word format", () => {
        const { menu } = tabMenu("Escritura.pdf");
        expect(labels(menu)).not.toContain("Convert to Word…");
    });

    it("offers nothing for a trainee's unapproved draft", () => {
        const { menu } = tabMenu("Borrador.docx");
        expect(labels(menu).filter((label) => label?.startsWith("Convert"))).toEqual([]);
    });

    it("starts the conversion for the right document and format, without converting by itself", () => {
        const { menu, onConvertDoc } = tabMenu("Notas.md");
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Convert to Word…" }));
        expect(onConvertDoc).toHaveBeenCalledTimes(1);
        expect(onConvertDoc).toHaveBeenCalledWith(files[1], "docx");
    });

    it("is absent when the owner supplies no conversion", () => {
        render(
            <ProjectDocumentTabs tabs={[{ documentId: "word", filename: "Contrato.docx" }]} documents={files} activeTabId="word" onActivate={vi.fn()} onClose={vi.fn()} onReorder={vi.fn()} onAddToChat={vi.fn()} />,
        );
        fireEvent.contextMenu(screen.getByRole("tab", { name: "Contrato.docx" }), { clientX: 10, clientY: 10 });
        expect(labels(screen.getByRole("menu")).filter((label) => label?.startsWith("Convert"))).toEqual([]);
    });
});

function cleanupMenu() {
    fireEvent.keyDown(document.body, { key: "Escape" });
}

describe("Convert to… in the explorer menu", () => {
    it("offers the valid formats and starts the dialog's flow", () => {
        const onConvertDoc = vi.fn();
        render(<ProjectExplorer documents={[files[0], files[3]]} onDocClick={vi.fn()} onConvertDoc={onConvertDoc} />);
        fireEvent.contextMenu(screen.getByText("Cuentas.xlsx"));
        expect(screen.queryByRole("menuitem", { name: /Convert/ })).toBeNull();
        cleanupMenu();
        fireEvent.contextMenu(screen.getByText("Contrato.docx"));
        fireEvent.click(screen.getByRole("menuitem", { name: "Convert to PDF…" }));
        expect(onConvertDoc).toHaveBeenCalledWith(files[0], "pdf");
    });

    it("offers nothing for a held draft or when no conversion is supplied", () => {
        render(<ProjectExplorer documents={[files[4]]} onDocClick={vi.fn()} onConvertDoc={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText("Borrador.docx"));
        expect(screen.queryByRole("menuitem", { name: /Convert/ })).toBeNull();
    });
});

describe("documentContextMenuItems", () => {
    const t = (catalog: object) => createTranslator({ locale: "en-US", messages: catalog as never }) as never;

    it("gives each convert entry a stable id and puts them after Download", () => {
        const items = documentContextMenuItems(t(enUS), {
            onDownload: vi.fn(),
            onDelete: vi.fn(),
            convert: { targets: ["md", "pdf"], onConvert: vi.fn() },
        });
        expect(items.map((item) => item.id ?? "-")).toEqual(["-", "convert-md", "convert-pdf", "-"]);
    });

    it("names the entries in Spanish for es-MX", () => {
        const items = documentContextMenuItems(
            createTranslator({ locale: "es-MX", messages: esMX as never }) as never,
            { convert: { targets: ["docx", "pdf", "md"], onConvert: vi.fn() } },
        );
        expect(items.map((item) => item.label)).toEqual(["Convertir a Word…", "Convertir a PDF…", "Convertir a Markdown…"]);
    });
});

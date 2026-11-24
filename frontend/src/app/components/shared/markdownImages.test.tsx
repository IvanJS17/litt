import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown as WordMarkdown } from "../../../../../word-addin/src/shared/chat/Markdown";
import { MarkdownContent } from "../assistant/message/MarkdownContent";
import { ReasoningBlock } from "../assistant/message/EventBlocks";
import { TRMessageBubble } from "../tabular/TRChatPanel";
import { TRSidePanel } from "../tabular/TRSidePanel";
import { TabularCell } from "../tabular/TabularCell";
import { WorkflowPickerContent } from "../workflows/WorkflowPickerContent";
import { WFColumnViewModal } from "../workflows/WFColumnViewModal";
import { WorkflowAddonPreviewModal } from "../workflows/WorkflowAddonPreviewModal";
import { LegalDocument } from "../legal/LegalDocument";
import { SignupLegal } from "../legal/SignupLegal";
import type {
    ColumnConfig,
    Document,
    TabularCell as TabularCellData,
    TabularReviewRow,
    Workflow,
    WorkflowAddon,
} from "./types";

// Text from a model or another person is drawn by many components. In each of
// them an image from another site must not be requested without a click.

const OTHER = "https://other.example/p.png?d=1";
const SAME = "/x.png";

const AVISO = vi.hoisted(() => ({ text: "" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/content/legal/avisoSimplificado", () => ({
    get AVISO_SIMPLIFICADO() {
        return AVISO.text;
    },
}));
vi.mock("../modals/Modal", () => ({
    Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../shared/views/PdfView", () => ({ PdfView: () => <div /> }));
vi.mock("../shared/views/DocxView", () => ({ DocxView: () => <div /> }));
vi.mock("../shared/views/MarkdownView", () => ({ MarkdownView: () => <div /> }));
vi.mock("../shared/views/SpreadsheetView", () => ({ SpreadsheetView: () => <div /> }));

const column = { index: 0, name: "Clause", prompt: "Extract" } as ColumnConfig;
const row = {
    id: "row-1",
    label: "Agreement.pdf",
    row_type: "document",
    document_id: "doc-1",
    source_document_ids: ["doc-1"],
} as TabularReviewRow;
const doc = { id: "doc-1", filename: "Agreement.pdf", file_type: "pdf" } as Document;
const cellWith = (summary: string) =>
    ({
        id: "cell-1",
        row_id: row.id,
        column_index: 0,
        status: "done",
        content: { summary, flag: "grey", reasoning: "" },
    }) as TabularCellData;

const workflow = (skill_md: string): Workflow => ({
    id: "workflow-1",
    user_id: "user-1",
    metadata: {
        title: "Review agreement",
        description: null,
        type: "assistant",
        contributors: [],
        language: "English",
        version: null,
        practice: "Commercial",
        jurisdictions: null,
    },
    skill_md,
    columns_config: null,
    is_system: true,
    created_at: "2026-08-18T00:00:00Z",
});

const addon = (prompt_md: string): WorkflowAddon => ({
    id: "addon-1",
    addon_key: "draft",
    pack_key: null,
    pack_title: null,
    pack_description: null,
    pack_version: null,
    version: "1.0.0",
    title: "Draft",
    description: "Draft.",
    type: "assistant",
    prompt_md,
    contributors: [],
    language: "English",
    practice: "General Transactions",
    jurisdictions: ["General"],
    active: true,
    updated_at: "2026-08-28T00:00:00.000Z",
    assets: [],
});

const SURFACES: [string, (md: string) => ReactElement, (() => void)?][] = [
    ["main chat", (md) => <MarkdownContent text={md} inlineCitationTargets={[]} />],
    ["reasoning block", (md) => <ReasoningBlock text={md} isStreaming />],
    [
        "table chat message",
        (md) => (
            <TRMessageBubble
                msg={{ role: "assistant", content: "", events: [{ type: "content", text: md }] } as never}
                onCitationClick={vi.fn()}
            />
        ),
    ],
    [
        "table side panel",
        (md) => (
            <TRSidePanel
                cell={cellWith(md)}
                row={row}
                rows={[row]}
                documents={[doc]}
                column={column}
                columns={[column]}
                onClose={vi.fn()}
                onNavigate={vi.fn()}
            />
        ),
    ],
    ["table cell", (md) => <TabularCell cell={cellWith(md)} onExpand={vi.fn()} onCitationClick={vi.fn()} />],
    [
        "workflow picker preview",
        (md) => (
            <WorkflowPickerContent
                workflows={[workflow(md)]}
                selected={workflow(md)}
                onSelect={vi.fn()}
                search=""
                onSearchChange={vi.fn()}
            />
        ),
        () => {
            Element.prototype.scrollIntoView = vi.fn();
        },
    ],
    [
        "workflow column view",
        (md) => <WFColumnViewModal col={{ ...column, prompt: md }} onClose={vi.fn()} />,
    ],
    [
        "workflow add-on preview",
        (md) => (
            <WorkflowAddonPreviewModal
                addon={addon(md)}
                importing={false}
                onClose={vi.fn()}
                onImport={vi.fn()}
            />
        ),
    ],
    ["legal document", (md) => <LegalDocument markdown={md} />],
    [
        "signup legal notice",
        (md) => {
            AVISO.text = md;
            return <SignupLegal />;
        },
    ],
    ["Word add-in chat", (md) => <WordMarkdown>{md}</WordMarkdown>],
];

describe.each(SURFACES)("Markdown images in %s", (name, ui, setup) => {
    const draw = (md: string) => {
        vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
        setup?.();
        const view = render(ui(md));
        if (name === "signup legal notice") fireEvent.click(screen.getByRole("button"));
        return view;
    };

    it("does not load an image from another site, and links to it instead", () => {
        draw(`![Chart](${OTHER})`);
        const imgs = Array.from(document.querySelectorAll("img"));
        expect(imgs.filter((img) => img.getAttribute("src")?.includes("other.example"))).toEqual([]);
        expect(document.querySelector('link[rel="preload"]')).toBeNull();
        const link = document.querySelector(`a[href="${OTHER}"]`);
        expect(link).not.toBeNull();
        expect(link).toHaveTextContent("Chart");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("keeps an image from the page's own origin", () => {
        draw(`![Local](${SAME})`);
        const img = document.querySelector("img[alt='Local']");
        expect(img).not.toBeNull();
        expect(img).toHaveAttribute("src", SAME);
    });
});

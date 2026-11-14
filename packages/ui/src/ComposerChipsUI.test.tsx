import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
    ActiveChipUI,
    AttachmentChipUI,
    COMPOSER_CHIP_REMOVE_CLASS,
    COMPOSER_DOC_CHIP_CLASS,
    ComposerChipsUI,
} from "./ComposerChipsUI";

const docs = [
    {
        key: "a",
        node: (
            <AttachmentChipUI
                name="Contrato marco.docx"
                icon={<svg />}
                onRemove={() => {}}
                removeLabel="Remove Contrato marco.docx"
            />
        ),
    },
    {
        key: "b",
        node: (
            <AttachmentChipUI
                name="Anexo A.pdf"
                icon={<svg />}
                onRemove={() => {}}
                removeLabel="Remove Anexo A.pdf"
            />
        ),
    },
];

/** The polite live region that announces switching a label on or off. */
function live(): HTMLElement {
    return document.querySelector<HTMLElement>("[aria-live='polite']")!;
}

function row(extra: Partial<React.ComponentProps<typeof ComposerChipsUI>> = {}) {
    return (
        <ComposerChipsUI
            announce
            workflow={{ title: "Revisar NDA", onOpen: () => {}, onDeactivate: () => {} }}
            playbook={{
                title: "Arrendamiento comercial",
                onOpen: () => {},
                onDeactivate: () => {},
            }}
            attached={docs}
            {...extra}
        />
    );
}

describe("the labels row", () => {
    it("is two named lists, what is switched on first and then what is attached", () => {
        render(row());
        const lists = screen.getAllByRole("list");
        expect(lists.map((l) => l.getAttribute("aria-label"))).toEqual([
            "Active",
            "Attached documents",
        ]);
        expect(within(lists[0]!).getAllByRole("listitem")).toHaveLength(2);
        expect(within(lists[1]!).getAllByRole("listitem")).toHaveLength(2);
        // Document order is the order a reader hears them.
        expect(
            lists[0]!.compareDocumentPosition(lists[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("leaves out a list that has nothing", () => {
        const { rerender } = render(row({ attached: [] }));
        expect(screen.getAllByRole("list")).toHaveLength(1);
        rerender(row({ workflow: null, playbook: null }));
        expect(screen.getAllByRole("list").map((l) => l.getAttribute("aria-label"))).toEqual([
            "Attached documents",
        ]);
    });

    it("says the whole row once, for the screen reader only", () => {
        render(row());
        const summary = screen.getByText(
            "Active: 1 workflow, 1 playbook · Attached: 2 documents",
        );
        expect(summary).toHaveClass("sr-only");
    });

    it("says only what is there in the summary", () => {
        render(row({ workflow: null, attached: docs.slice(0, 1) }));
        expect(screen.getByText("Active: 1 playbook · Attached: 1 document")).toHaveClass(
            "sr-only",
        );
    });

    it("deactivates a workflow or a playbook, and removes a document", async () => {
        const user = userEvent.setup();
        const onDeactivateWorkflow = vi.fn();
        const onDeactivatePlaybook = vi.fn();
        const onRemove = vi.fn();
        render(
            row({
                workflow: { title: "Revisar NDA", onDeactivate: onDeactivateWorkflow },
                playbook: { title: "Arrendamiento comercial", onDeactivate: onDeactivatePlaybook },
                attached: [
                    {
                        key: "a",
                        node: (
                            <AttachmentChipUI
                                name="Contrato marco.docx"
                                icon={<svg />}
                                onRemove={onRemove}
                                removeLabel="Remove Contrato marco.docx"
                            />
                        ),
                    },
                ],
            }),
        );
        await user.click(
            screen.getByRole("button", { name: "Deactivate the workflow Revisar NDA" }),
        );
        await user.click(
            screen.getByRole("button", {
                name: "Deactivate the playbook Arrendamiento comercial",
            }),
        );
        await user.click(screen.getByRole("button", { name: "Remove Contrato marco.docx" }));
        expect(onDeactivateWorkflow).toHaveBeenCalledOnce();
        expect(onDeactivatePlaybook).toHaveBeenCalledOnce();
        expect(onRemove).toHaveBeenCalledOnce();
        // "Quitar" is for documents only.
        expect(screen.queryByRole("button", { name: /^Remove (the )?(workflow|playbook)/ })).toBeNull();
    });

    it("names what each opening button opens", () => {
        render(row());
        expect(
            screen.getByRole("button", { name: "Open the active workflow Revisar NDA" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", {
                name: "Open the active playbook Arrendamiento comercial",
            }),
        ).toBeInTheDocument();
    });

    it("announces switching one on or off, but not what was there at the start", () => {
        const { rerender } = render(
            row({ workflow: null, playbook: null, attached: [] }),
        );
        const region = live();
        expect(region).toHaveAttribute("aria-live", "polite");
        expect(region).toHaveTextContent("");
        rerender(
            row({
                workflow: { title: "Revisar NDA", onDeactivate: () => {} },
                playbook: null,
                attached: [],
            }),
        );
        expect(live()).toHaveTextContent("Workflow activated: Revisar NDA");
        rerender(
            row({
                workflow: { title: "Revisar NDA", onDeactivate: () => {} },
                playbook: { title: "Arrendamiento", onDeactivate: () => {} },
                attached: [],
            }),
        );
        expect(live()).toHaveTextContent("Playbook activated: Arrendamiento");
        rerender(row({ workflow: null, playbook: null, attached: [] }));
        // The last label went away: the region is still in the page to say so.
        expect(live()).toHaveTextContent(
            "Workflow deactivated: Revisar NDA. Playbook deactivated: Arrendamiento",
        );
    });

    it("starts with a workflow already on and says nothing", () => {
        render(row());
        expect(live()).toHaveTextContent("");
    });

    it("has no ×, no live region and no buttons in a sent message", () => {
        render(
            <ComposerChipsUI
                workflow={{ title: "Revisar NDA" }}
                playbook={{ title: "Arrendamiento comercial" }}
                attached={[
                    {
                        key: "a",
                        node: <AttachmentChipUI name="Contrato.docx" icon={<svg />} />,
                    },
                ]}
            />,
        );
        expect(document.querySelector("[aria-live]")).toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
        // Still two lists, and still typed.
        expect(screen.getAllByRole("list")).toHaveLength(2);
        expect(screen.getByRole("img", { name: "Workflow: Revisar NDA" })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Playbook: Arrendamiento comercial" })).toBeInTheDocument();
    });
});

describe("an active label", () => {
    it("writes its type in a segment of its own, and never cuts it", () => {
        const { container } = render(
            <ActiveChipUI
                kind="playbook"
                title="Arrendamiento comercial · criterios del despacho 2026"
                onOpen={() => {}}
                onDeactivate={() => {}}
            />,
        );
        const chip = container.querySelector("[data-chip='playbook']")!;
        const type = within(chip as HTMLElement).getByText("Playbook");
        expect(type).toHaveClass("shrink-0", "font-semibold");
        expect(type).not.toHaveClass("truncate");
        expect(type).toHaveAttribute("aria-hidden", "true");
        const name = within(chip as HTMLElement).getByText(/Arrendamiento comercial/);
        expect(name).toHaveClass("truncate", "min-w-0");
        // The type is the only thing with a fixed place: the name gives way.
        expect(name.className).toMatch(/max-w-\[9\.5em\]/);
    });

    it("reads Flujo in es-MX by catalog key", () => {
        render(<ActiveChipUI kind="workflow" title="Revisar NDA" />);
        // The test locale is en-US: the key resolves to "Workflow".
        expect(screen.getByRole("img", { name: "Workflow: Revisar NDA" })).toBeInTheDocument();
    });

    it("has a firm outline, no fill and no amber", () => {
        const { container } = render(
            <ActiveChipUI kind="workflow" title="Revisar NDA" onDeactivate={() => {}} />,
        );
        const chip = container.querySelector("[data-chip='workflow']")!;
        expect(chip.className).toContain("var(--litt-composer-active-ring)");
        expect(chip.className).not.toMatch(
            /\bbg-(?!transparent)|amber|ambar|bg-gray|bg-interactive\b|bg-black|bg-white/,
        );
    });
});

describe("an attachment label", () => {
    it("is the soft sheet, not glass and not filled", () => {
        expect(COMPOSER_DOC_CHIP_CLASS).toContain("var(--litt-composer-chip)");
        expect(COMPOSER_DOC_CHIP_CLASS).toContain("var(--litt-composer-chip-ring)");
        expect(COMPOSER_DOC_CHIP_CLASS).toContain("rounded-[7px]");
        expect(COMPOSER_DOC_CHIP_CLASS).toContain("h-6");
        expect(COMPOSER_DOC_CHIP_CLASS).not.toMatch(/glass|amber|ambar|bg-gray|bg-white/);
    });

    it("has a 16 px × with 4 px corners", () => {
        expect(COMPOSER_CHIP_REMOVE_CLASS).toContain("size-4");
        expect(COMPOSER_CHIP_REMOVE_CLASS).toContain("rounded-[4px]");
    });

    it("keeps the icon of its type and reads a status after the name", () => {
        render(
            <AttachmentChipUI
                name="nda.pdf"
                icon={<svg data-testid="type-icon" />}
                status="Uploading"
                loading
            />,
        );
        expect(screen.getByTestId("type-icon")).toBeInTheDocument();
        expect(screen.getByTitle("nda.pdf · Uploading")).toHaveTextContent("nda.pdf, Uploading");
    });
});

describe("amber and fills", () => {
    it("are not in the labels' code", () => {
        const source = readFileSync(
            resolve(process.cwd(), "..", "packages/ui/src/ComposerChipsUI.tsx"),
            "utf8",
        );
        expect(source).not.toMatch(
            /(?:bg|text|border|ring|outline|fill|stroke)-(?:amber|yellow|orange|gray-700|interactive(?!-soft)\b)|#ffb21e|#965900|liquid-glass|LIQUID_GLASS/i,
        );
    });
});

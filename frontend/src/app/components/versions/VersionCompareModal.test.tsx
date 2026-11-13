import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VersionCompare, VersionCompareSide } from "@mike/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { VersionCompareModal } from "./VersionCompareModal";

const mocks = vi.hoisted(() => ({
    compare: vi.fn(),
    download: vi.fn(),
    notifyError: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    compareDocumentVersions: mocks.compare,
}));
vi.mock("@/app/lib/downloadDocument", () => ({ downloadDocumentFile: mocks.download }));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
    notifyError: mocks.notifyError,
}));

const version = (
    id: string,
    number: number,
    source: string,
    filename = "contrato.md",
    deleted = false,
): DocumentVersion => ({
    id,
    version_number: number,
    source,
    created_at: `2026-11-0${number}T10:00:00Z`,
    filename,
    deleted_at: deleted ? "2026-11-10T00:00:00Z" : null,
});

const VERSIONS = [
    version("v1", 1, "upload"),
    version("v2", 2, "assistant_edit"),
    version("v3", 3, "user_edit"),
    version("v0", 0, "upload", "borrada.md", true),
];

const side = (
    id: string,
    source: string,
    text: string | null,
    extra: Partial<VersionCompareSide> = {},
): VersionCompareSide => ({
    id,
    version_number: Number(id.slice(1)),
    filename: "contrato.md",
    source,
    created_at: "2026-11-01T10:00:00Z",
    text_status: "ready",
    text,
    too_large: false,
    textless_page_count: null,
    ...extra,
});

const BASE_TEXT = [
    "# Plazos",
    "El plazo es de 30 días.",
    "Texto igual 1",
    "Texto igual 2",
    "Texto igual 3",
    "Texto igual 4",
    "Texto igual 5",
    "Texto igual 6",
    "# Partes",
    "El cliente paga.",
    "Fin",
].join("\n");
const HEAD_TEXT = BASE_TEXT.replace("30 días", "45 días").replace("El cliente paga.", "El cliente paga puntualmente.");

function serve(data?: Partial<VersionCompare>) {
    mocks.compare.mockResolvedValue({
        base: side("v2", "assistant_edit", BASE_TEXT),
        head: side("v3", "user_edit", HEAD_TEXT),
        ...data,
    });
}

function renderModal(
    props: Partial<React.ComponentProps<typeof VersionCompareModal>> = {},
) {
    const onClose = vi.fn();
    render(
        <VersionCompareModal
            open
            onClose={onClose}
            documentId="doc"
            versions={VERSIONS}
            currentVersionId="v3"
            {...props}
        />,
    );
    return { onClose };
}

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    serve();
});
afterEach(() => vi.restoreAllMocks());

const diffTable = () => screen.getByRole("table");

describe("VersionCompareModal", () => {
    it("compares the previous version with the current one by default", async () => {
        renderModal();
        expect(screen.getByRole("status", { name: "Loading comparison" })).toBeVisible();
        await screen.findByRole("table");
        expect(mocks.compare).toHaveBeenCalledWith("doc", "v2", "v3");
        expect(screen.getByText("Compares the text, not the formatting.")).toBeVisible();
        // The dropdown triggers carry the chosen version, the author and the file name.
        expect(screen.getByLabelText("Base version")).toHaveTextContent("Version 2 · AI · contrato.md");
        expect(screen.getByLabelText("Revised version")).toHaveTextContent("Version 3 · Person · contrato.md");
        expect(screen.getAllByText(/^Made by: /).map((n) => n.textContent)).toEqual([
            "Made by: AI",
            "Made by: Person",
        ]);
    });

    it("labels each version AI or Person from its source, not its text", async () => {
        serve({
            base: side("v2", "generated", "Hecho por una persona\n"),
            head: side("v3", "user_accept", "Hecho por una IA\n"),
        });
        renderModal();
        await screen.findByRole("table");
        expect(screen.getAllByText(/^Made by: /).map((n) => n.textContent)).toEqual([
            "Made by: AI",
            "Made by: Person",
        ]);
    });

    it("marks changes with ins and del plus words for screen readers", async () => {
        renderModal();
        await screen.findByRole("table");
        const removed = diffTable().querySelector("del[data-numeric]")!;
        const added = diffTable().querySelector("ins[data-numeric]")!;
        expect(removed).toHaveTextContent("Removed: 30");
        expect(added).toHaveTextContent("Added: 45");
        expect(diffTable().querySelector("ins:not([data-numeric])")).toHaveTextContent(
            /Added:\s+puntualmente/,
        );
    });

    it("shows side by side and unified", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        expect(screen.getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
        expect(diffTable().querySelectorAll("col")).toHaveLength(4);
        // The same line, old and new, on one row.
        const row = diffTable().querySelector("del[data-numeric]")!.closest("tr")!;
        expect(row.querySelector("ins[data-numeric]")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Unified" }));
        expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
        expect(diffTable().querySelectorAll("col")).toHaveLength(3);
        const rows = [...diffTable().querySelectorAll("tr")];
        const removedRow = rows.find((tr) => tr.querySelector("del"))!;
        const addedRow = rows.find((tr) => tr.querySelector("ins"))!;
        expect(rows.indexOf(removedRow)).toBeLessThan(rows.indexOf(addedRow));
        expect(within(removedRow as HTMLElement).getByText("Base line 2")).toBeInTheDocument();
        expect(within(addedRow as HTMLElement).getByText("Revised line 2")).toBeInTheDocument();
    });

    it("walks the changes with Previous and Next and counts them", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        const counter = () => screen.getAllByRole("status").find((n) => /Change \d of \d/.test(n.textContent ?? ""))!;
        expect(counter()).toHaveTextContent("Change 1 of 2");
        const previous = screen.getByRole("button", { name: "Previous change" });
        const next = screen.getByRole("button", { name: "Next change" });
        expect(previous).toBeDisabled();
        await user.click(next);
        expect(counter()).toHaveTextContent("Change 2 of 2");
        expect(next).toBeDisabled();
        const bodies = [...diffTable().querySelectorAll("tbody[data-change-index]")];
        expect(bodies[1]).toHaveAttribute("aria-current", "true");
        expect(bodies[0]).not.toHaveAttribute("aria-current");
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        await user.click(previous);
        expect(counter()).toHaveTextContent("Change 1 of 2");
    });

    it("filters to the changes whose changed text has a digit", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        expect(screen.getByText("El cliente paga puntualmente.", { exact: false })).toBeInTheDocument();
        await user.click(screen.getByRole("checkbox", { name: "Only changes with numbers" }));
        expect(screen.getAllByText(/Change 1 of 1/).length).toBeGreaterThan(0);
        expect(within(diffTable()).queryByText(/puntualmente/)).toBeNull();
        expect(within(diffTable()).getByText(/45/)).toBeVisible();
        // A gap that also folds a change the filter left out says "hidden", not "unchanged".
        expect(
            within(diffTable()).getAllByRole("button", { name: /Show \d+ hidden lines?/ }).length,
        ).toBeGreaterThan(0);
        expect(screen.getAllByText("Contains numbers").length).toBeGreaterThan(0);
    });

    it("opens a gap of unchanged lines on request", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        const gaps = () =>
            within(diffTable()).getAllByRole("button", { name: /Show \d+ unchanged lines?/ });
        const before = gaps().length;
        expect(gaps()[0]).toHaveAttribute("aria-expanded", "false");
        await user.click(gaps()[0]);
        // The button is gone; focus lands on the first line it revealed, not on the page.
        expect(document.body).not.toHaveFocus();
        expect(diffTable().contains(document.activeElement)).toBe(true);
        expect(within(diffTable()).queryAllByRole("button", { name: /Show \d+ unchanged/ }).length).toBe(before - 1);
    });

    it("numbers a change in the list like the counter does when the filter is on", async () => {
        const user = userEvent.setup();
        serve({
            base: side("v2", "assistant_edit", BASE_TEXT.replace("30 días", "treinta días")),
            head: side(
                "v3",
                "user_edit",
                BASE_TEXT.replace("30 días", "cuarenta días").replace(
                    "El cliente paga.",
                    "El cliente paga 45 veces.",
                ),
            ),
        });
        renderModal();
        await screen.findByRole("table");
        const list = screen.getByRole("navigation", { name: "List of changes" });
        expect(within(list).getByRole("button", { name: /Go to change 2:/ })).toBeVisible();
        await user.click(screen.getByRole("checkbox", { name: "Only changes with numbers" }));
        expect(screen.getAllByText(/Change 1 of 1/).length).toBeGreaterThan(0);
        expect(within(list).getByRole("button", { name: /Go to change 1:/ })).toBeVisible();
        expect(within(list).queryByRole("button", { name: /Go to change 2:/ })).toBeNull();
    });

    it("says so when no change has numbers", async () => {
        const user = userEvent.setup();
        serve({
            base: side("v2", "upload", "uno\n"),
            head: side("v3", "upload", "dos\n"),
        });
        renderModal();
        await screen.findByRole("table");
        await user.click(screen.getByRole("checkbox", { name: "Only changes with numbers" }));
        expect(screen.getByText("No changes with numbers")).toBeVisible();
        expect(screen.queryByRole("table")).toBeNull();
    });

    it("lists the changes under the nearest title in a .md and jumps to one on click", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        const list = screen.getByRole("navigation", { name: "List of changes" });
        expect(within(list).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Plazos", "Partes"]);
        await user.click(within(list).getByRole("button", { name: /Go to change 2:/ }));
        const bodies = [...diffTable().querySelectorAll("tbody[data-change-index]")];
        expect(bodies[1]).toHaveAttribute("aria-current", "true");
        expect(within(list).getByRole("button", { name: /Go to change 2:/ })).toHaveAttribute("aria-current", "true");
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it("lists Word and PDF changes by paragraph number", async () => {
        serve({
            base: side("v2", "upload", "Uno\nDos\nTres\n", { filename: "contrato.docx" }),
            head: side("v3", "upload", "Uno\nDOS\nTres\n", { filename: "contrato.docx" }),
        });
        renderModal();
        await screen.findByRole("table");
        const list = screen.getByRole("navigation", { name: "List of changes" });
        expect(within(list).queryByRole("heading")).toBeNull();
        expect(within(list).getByText("Paragraph 2")).toBeVisible();
    });

    it.each(["pending", "failed", "none"] as const)("explains a version whose text is %s", async (status) => {
        serve({ head: side("v3", "user_edit", null, { text_status: status }) });
        renderModal();
        expect(await screen.findByText("This version doesn't have text to compare yet.")).toBeVisible();
        expect(screen.queryByRole("table")).toBeNull();
        expect(screen.queryByRole("button", { name: "Unified" })).toBeNull();
    });

    it("refuses a text the server withheld, and offers both files", async () => {
        const user = userEvent.setup();
        serve({ base: side("v2", "upload", null, { too_large: true }) });
        renderModal();
        expect(await screen.findByText("Document too large to compare here.")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Download base version" }));
        await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("doc", "v2", "contrato.md"));
        await user.click(screen.getByRole("button", { name: "Download revised version" }));
        await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("doc", "v3", "contrato.md"));
    });

    it("refuses a text over the line limit the same way, and reports a failed download", async () => {
        const user = userEvent.setup();
        const long = "x\n".repeat(20_001);
        serve({ base: side("v2", "upload", long), head: side("v3", "upload", long + "y") });
        mocks.download.mockRejectedValue(new Error("nope"));
        renderModal();
        expect(await screen.findByText("Document too large to compare here.")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Download base version" }));
        await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    });

    it("warns about scanned pages without text", async () => {
        serve({ head: side("v3", "user_edit", HEAD_TEXT, { textless_page_count: 2 }) });
        renderModal();
        await screen.findByRole("table");
        expect(
            screen.getByText("2 pages of this version are scanned and have no text, so they cannot be compared."),
        ).toBeVisible();
    });

    it("says when there is nothing to see", async () => {
        serve({ base: side("v2", "upload", "igual\n"), head: side("v3", "upload", "igual\n") });
        renderModal();
        expect(await screen.findByText("There are no text differences between these two versions.")).toBeVisible();
    });

    it("lets the person retry a failed load", async () => {
        const user = userEvent.setup();
        mocks.compare.mockRejectedValueOnce(new Error("down"));
        renderModal();
        expect(await screen.findByRole("alert")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Try again" }));
        await screen.findByRole("table");
        expect(mocks.compare).toHaveBeenCalledTimes(2);
    });

    it("compares another pair when the person picks one", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        await user.click(screen.getByLabelText("Base version"));
        await user.click(await screen.findByRole("menuitem", { name: /Version 1/ }));
        await waitFor(() => expect(mocks.compare).toHaveBeenLastCalledWith("doc", "v1", "v3"));
        expect(await screen.findByLabelText("Base version")).toHaveTextContent("Version 1 · Person");
    });

    it("asks for two different versions", async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByRole("table");
        await user.click(screen.getByLabelText("Base version"));
        await user.click(await screen.findByRole("menuitem", { name: /Version 3/ }));
        expect(await screen.findByText("Pick two different versions to compare.")).toBeVisible();
    });

    it("starts from the newest version when none is marked current", async () => {
        renderModal({ currentVersionId: null });
        await screen.findByRole("table");
        expect(mocks.compare).toHaveBeenCalledWith("doc", "v2", "v3");
    });

    it("names versions that have no number", async () => {
        renderModal({
            versions: [
                { ...version("a", 1, "upload"), version_number: null },
                { ...version("b", 2, "upload"), version_number: null, created_at: "2026-11-09T00:00:00Z" },
            ],
            currentVersionId: null,
        });
        await screen.findByRole("table").catch(() => undefined);
        expect(screen.getByLabelText("Revised version")).toHaveTextContent("Person · contrato.md");
    });

    it("closes with the close button", async () => {
        const user = userEvent.setup();
        const { onClose } = renderModal();
        await screen.findByRole("table");
        await user.click(screen.getByRole("button", { name: /close/i }));
        expect(onClose).toHaveBeenCalled();
    });
});

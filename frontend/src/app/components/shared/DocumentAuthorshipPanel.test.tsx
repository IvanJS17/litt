import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DocumentAuthorship } from "@mike/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";

const api = vi.hoisted(() => ({ getDocumentAuthorship: vi.fn() }));
const notifyError = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/mikeApi", () => api);
vi.mock("@/app/lib/userFacingError", () => ({ notifyError }));

import { DocumentAuthorshipPanel } from "./DocumentAuthorshipPanel";

const ready = (overrides: Partial<DocumentAuthorship> = {}): DocumentAuthorship => ({
    document_id: "doc-1",
    version_id: "v2",
    status: "ok",
    estimate: true,
    baseline: "ai",
    words: { total: 200, person: 90, ai: 80, undetermined: 30 },
    shares: { person: 45, ai: 40, undetermined: 15 },
    edits: { accepted: 3, rejected: 1, pending: 0 },
    textless_pages: 0,
    ...overrides,
});

beforeEach(() => {
    api.getDocumentAuthorship.mockReset();
    notifyError.mockReset();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: /authorship|autoría/i }));

describe("in English", () => {
    it("asks nothing until it is opened, then shows the figures with the rule", async () => {
        api.getDocumentAuthorship.mockResolvedValue(ready());
        render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        const toggle = screen.getByRole("button", { name: "Show estimated authorship" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(api.getDocumentAuthorship).not.toHaveBeenCalled();

        fireEvent.click(toggle);
        expect(screen.getByRole("button", { name: "Hide estimated authorship" })).toHaveAttribute(
            "aria-expanded",
            "true",
        );
        expect(screen.getByRole("status", { name: "Loading…" })).toHaveAttribute("aria-busy", "true");
        expect(await screen.findByText("Written by a person")).toBeInTheDocument();
        expect(api.getDocumentAuthorship).toHaveBeenCalledWith("doc-1", "v2");
        const figures = screen.getAllByRole("definition").map((node) => node.textContent);
        expect(figures).toEqual(["45%", "40%", "15%"]);
        expect(screen.getByText("From the assistant")).toBeInTheDocument();
        expect(screen.getByText("Undetermined")).toBeInTheDocument();
        expect(screen.getByText(/200 words analyzed\. Estimate, rounded to the nearest 5%\./)).toBeInTheDocument();
        expect(screen.getByText("Assistant edits: 3 accepted, 1 rejected, 0 pending.")).toBeInTheDocument();
        expect(screen.getByText(/not an AI detector/)).toBeInTheDocument();
        expect(screen.queryByText(/uploaded file/)).toBeNull();
    });

    it("asks again when it is reopened, so the figures follow the edits", async () => {
        api.getDocumentAuthorship.mockResolvedValue(ready());
        render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        await screen.findByText("Written by a person");
        open();
        expect(screen.getByRole("button", { name: "Show estimated authorship" })).toHaveAttribute(
            "aria-expanded",
            "false",
        );
        open();
        expect(screen.getByText("Written by a person")).toBeInTheDocument();
        await waitFor(() => expect(api.getDocumentAuthorship).toHaveBeenCalledTimes(2));
    });

    it("renders nothing without a version", () => {
        const { container } = render(<DocumentAuthorshipPanel documentId="doc-1" versionId={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("asks again for another version", async () => {
        api.getDocumentAuthorship.mockResolvedValue(ready());
        const { rerender } = render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v1" />);
        open();
        await screen.findByText("Written by a person");
        rerender(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        await waitFor(() => expect(api.getDocumentAuthorship).toHaveBeenLastCalledWith("doc-1", "v2"));
    });

    it("says what it could not place instead of guessing", async () => {
        api.getDocumentAuthorship.mockResolvedValue(
            ready({
                baseline: "file",
                shares: { person: 0, ai: 0, undetermined: 100 },
                words: { total: 40, person: 0, ai: 0, undetermined: 40 },
                edits: { accepted: 0, rejected: 0, pending: 2 },
                textless_pages: 3,
            }),
        );
        render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        expect(await screen.findByText(/started from an uploaded file/)).toBeInTheDocument();
        expect(screen.getByText(/2 assistant edits are still pending/)).toBeInTheDocument();
        expect(screen.getByText(/3 pages have no text LiTT can read/)).toBeInTheDocument();
        expect(screen.getAllByRole("definition").map((node) => node.textContent)).toEqual(["0%", "0%", "100%"]);
    });

    it("says when the starting text is unknown", async () => {
        api.getDocumentAuthorship.mockResolvedValue(ready({ baseline: "unknown" }));
        render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        expect(await screen.findByText(/no record of the text this version started from/)).toBeInTheDocument();
    });

    it.each([
        ["text_pending", /hasn't finished reading/],
        ["text_failed", /couldn't read the text/],
        ["too_large", /too long to estimate/],
        ["empty", /no text to analyze/],
    ] as const)("%s is undetermined and shows no figures", async (status, message) => {
        api.getDocumentAuthorship.mockResolvedValue(ready({ status, words: null, shares: null }));
        render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.queryAllByRole("definition")).toHaveLength(0);
    });

    it("reports a failure once and offers Retry that asks again", async () => {
        api.getDocumentAuthorship.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(ready());
        render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        expect(await screen.findByText("Couldn't load the estimated authorship.")).toBeInTheDocument();
        expect(notifyError).toHaveBeenCalledTimes(1);
        const [, options] = notifyError.mock.calls[0];
        expect(options).toMatchObject({ action: "load the estimated authorship", operation: "training.read" });
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("Written by a person")).toBeInTheDocument();
        expect(api.getDocumentAuthorship).toHaveBeenCalledTimes(2);
    });

    it("ignores an answer that arrives after it was closed away", async () => {
        let resolve!: (value: DocumentAuthorship) => void;
        api.getDocumentAuthorship.mockReturnValue(new Promise((ok) => (resolve = ok)));
        const { unmount } = render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        unmount();
        await act(async () => resolve(ready()));
        expect(notifyError).not.toHaveBeenCalled();
    });

    it("ignores a failure that arrives after it was closed away", async () => {
        let reject!: (reason: unknown) => void;
        api.getDocumentAuthorship.mockReturnValue(new Promise((_, fail) => (reject = fail)));
        const { unmount } = render(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        open();
        unmount();
        await act(async () => reject(new Error("late")));
        expect(notifyError).not.toHaveBeenCalled();
    });
});

describe("in es-MX", () => {
    const renderEs = (ui: React.ReactElement) =>
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                {ui}
            </IntlClientProvider>,
        );

    it("speaks Spanish and says «no determinado» for what it cannot place", async () => {
        api.getDocumentAuthorship.mockResolvedValue(
            ready({ baseline: "file", edits: { accepted: 1, rejected: 0, pending: 1 }, textless_pages: 1 }),
        );
        renderEs(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        fireEvent.click(screen.getByRole("button", { name: "Ver autoría estimada" }));
        expect(await screen.findByText("Escrito por una persona")).toBeInTheDocument();
        expect(screen.getByText("De la IA")).toBeInTheDocument();
        expect(screen.getByText("No determinado")).toBeInTheDocument();
        expect(screen.getAllByRole("definition").map((node) => node.textContent)).toEqual(["45 %", "40 %", "15 %"]);
        expect(screen.getByText(/200 palabras analizadas\. Estimación, redondeada a múltiplos de 5 %\./)).toBeInTheDocument();
        expect(screen.getByText("Ediciones de la IA: 1 aceptadas, 0 rechazadas, 1 pendientes.")).toBeInTheDocument();
        expect(screen.getByText(/no un detector de IA/)).toBeInTheDocument();
        expect(screen.getByText(/partió de un archivo subido/)).toBeInTheDocument();
        expect(screen.getByText(/Hay 1 edición de la IA pendiente/)).toBeInTheDocument();
        expect(screen.getByText(/1 página no tiene texto/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ocultar autoría estimada" })).toBeInTheDocument();
    });

    it("has a region named after the panel and a toggle tied to its content", async () => {
        api.getDocumentAuthorship.mockResolvedValue(ready());
        renderEs(<DocumentAuthorshipPanel documentId="doc-1" versionId="v2" />);
        const region = screen.getByRole("region", { name: "Autoría estimada" });
        const toggle = within(region).getByRole("button");
        expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeNull();
        fireEvent.click(toggle);
        await screen.findByText("Escrito por una persona");
    });
});

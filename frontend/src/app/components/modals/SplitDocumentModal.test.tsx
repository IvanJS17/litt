import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSplitProposal, DocumentSplitState } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { SplitDocumentModal } from "./SplitDocumentModal";

const mocks = vi.hoisted(() => ({ state: vi.fn(), propose: vi.fn(), create: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({
    getDocumentSplitState: mocks.state,
    proposeDocumentSplit: mocks.propose,
    createSplitDocuments: mocks.create,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notify }));

const CLASSES = [
    { name: "Poder o documento de personalidad", description: "d" },
    { name: "Constancia de situación fiscal", description: "d", identifier: "RFC del contribuyente" },
];
const STATE: DocumentSplitState = {
    version_id: "v1",
    page_count: 6,
    characters: 79500,
    estimated_credits: 15.9,
    estimated_cost_usd: 0.159,
    unread_pages: 0,
    needs_scan_reading: false,
    too_large: false,
    key_available: true,
    can_edit: true,
    classes: CLASSES,
    classes_source: "default",
};
const PROPOSAL: DocumentSplitProposal = {
    version_id: "v1",
    page_count: 6,
    credits: 15.9,
    classes: CLASSES,
    groups: [
        { type: "Poder o documento de personalidad", identifier: null, pages: [1, 2, 3] },
        { type: "Constancia de situación fiscal", identifier: "GACM701119BH5", pages: [4] },
        { type: null, identifier: null, pages: [5, 6] },
    ],
};
const CREATED = { documents: [{ document_id: "n1", version_id: "nv1", filename: "a.pdf", file_type: "pdf", size_bytes: 1, project_id: "p", folder_id: null }] };
const request = { documentId: "doc-1", filename: "Expediente.pdf" };

const open = (props: Partial<Parameters<typeof SplitDocumentModal>[0]> = {}) =>
    render(<SplitDocumentModal request={request} onClose={vi.fn()} onCreated={vi.fn()} {...props} />);
const proposeButton = () => screen.getByRole("button", { name: "Send and propose a split" });

async function reachPreview(props: Partial<Parameters<typeof SplitDocumentModal>[0]> = {}) {
    open(props);
    await screen.findByText(/Estimated cost/);
    await userEvent.click(proposeButton());
    await screen.findByLabelText("Proposed documents");
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.mockResolvedValue(STATE);
    mocks.propose.mockResolvedValue(PROPOSAL);
    mocks.create.mockResolvedValue(CREATED);
});

describe("the notice", () => {
    it("is closed with no request and asks nothing", () => {
        open({ request: null });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(mocks.state).not.toHaveBeenCalled();
    });

    it("shows the notice and the estimated cost, and sends nothing until the button is pressed", async () => {
        open();
        expect(screen.getByRole("status")).toHaveTextContent("Checking the document…");
        expect(await screen.findByText("6 pages. Estimated cost: 15.9 LandingAI credits, about USD 0.16.")).toBeInTheDocument();
        expect(screen.getByText(/will send the full text of this document to LandingAI, in the United States/)).toBeInTheDocument();
        expect(screen.getByText(/may keep the text and use it to improve its products and train its models/)).toBeInTheDocument();
        expect(screen.getByText("Split “Expediente.pdf” into separate documents.")).toBeInTheDocument();
        // No checkbox: pressing the button is the instruction.
        expect(screen.queryByRole("checkbox")).toBeNull();
        expect(mocks.state).toHaveBeenCalledWith("doc-1", expect.any(AbortSignal));
        expect(mocks.propose).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("says a price under a cent instead of free", async () => {
        mocks.state.mockResolvedValue({ ...STATE, estimated_credits: 0.1, estimated_cost_usd: 0.001 });
        open();
        expect(await screen.findByText("6 pages. Estimated cost: 0.1 LandingAI credits, about USD < 0.01.")).toBeInTheDocument();
    });

    it("blocks the button while scanned pages are unread, with the reason", async () => {
        mocks.state.mockResolvedValue({ ...STATE, unread_pages: 2, needs_scan_reading: true });
        open();
        expect(await screen.findByRole("alert")).toHaveTextContent("2 pages are scanned and haven’t been read yet. Use “Read scan” first");
        expect(proposeButton()).toBeDisabled();
    });

    it("blocks the button for a document that is too large", async () => {
        mocks.state.mockResolvedValue({ ...STATE, too_large: true });
        open();
        expect(await screen.findByRole("alert")).toHaveTextContent("too large to split");
        expect(proposeButton()).toBeDisabled();
    });

    it("blocks the button without a key or without edit rights", async () => {
        mocks.state.mockResolvedValue({ ...STATE, key_available: false });
        const first = open();
        await screen.findByText(/Estimated cost/);
        expect(proposeButton()).toBeDisabled();
        first.unmount();
        mocks.state.mockResolvedValue({ ...STATE, can_edit: false });
        open();
        await screen.findByText(/Estimated cost/);
        expect(proposeButton()).toBeDisabled();
    });

    it("closes with an error notice when the notice cannot be loaded", async () => {
        const failure = new Error("403");
        mocks.state.mockRejectedValueOnce(failure);
        const onClose = vi.fn();
        open({ onClose });
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(mocks.notify).toHaveBeenCalledWith(failure, { action: "check what splitting this file would cost" });
    });

    it("does not report a load that was abandoned", async () => {
        let fail: (error: Error) => void = () => {};
        mocks.state.mockReturnValue(new Promise((_, reject) => (fail = reject)));
        const onClose = vi.fn();
        open({ onClose }).unmount();
        fail(new Error("late"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.notify).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it("cancel closes without sending", async () => {
        const onClose = vi.fn();
        open({ onClose });
        await screen.findByText(/Estimated cost/);
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.propose).not.toHaveBeenCalled();
    });
});

describe("asking for the proposal", () => {
    it("sends once, shows the wait, and cannot be closed meanwhile", async () => {
        let finish: (value: DocumentSplitProposal) => void = () => {};
        mocks.propose.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const onClose = vi.fn();
        open({ onClose });
        await screen.findByText(/Estimated cost/);
        await userEvent.click(proposeButton());
        expect(mocks.propose).toHaveBeenCalledTimes(1);
        expect(mocks.propose).toHaveBeenCalledWith("doc-1");
        expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
        expect(screen.getByText(/Waiting for LandingAI’s proposal/)).toBeInTheDocument();
        await userEvent.keyboard("{Escape}");
        expect(onClose).not.toHaveBeenCalled();
        finish(PROPOSAL);
        await screen.findByLabelText("Proposed documents");
    });

    it("reports a failure with a retry that asks again, and stays on the notice", async () => {
        const failure = new Error("boom");
        mocks.propose.mockRejectedValueOnce(failure);
        open();
        await screen.findByText(/Estimated cost/);
        await userEvent.click(proposeButton());
        await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
        const [error, options] = mocks.notify.mock.calls[0];
        expect(error).toBe(failure);
        expect(options.action).toBe("split this file");
        expect(proposeButton()).toBeEnabled();
        await options.onRetry();
        await screen.findByLabelText("Proposed documents");
        expect(mocks.propose).toHaveBeenCalledTimes(2);
    });

    it("ignores an answer that arrives after the dialog was closed", async () => {
        let finish: (value: DocumentSplitProposal) => void = () => {};
        mocks.propose.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const view = open();
        await screen.findByText(/Estimated cost/);
        await userEvent.click(proposeButton());
        view.unmount();
        finish(PROPOSAL);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.create).not.toHaveBeenCalled();
    });
});

describe("the editable preview", () => {
    it("lists the groups with their page ranges, types and names, all checked, and says adjusting is free", async () => {
        await reachPreview();
        const list = screen.getByLabelText("Proposed documents");
        const items = within(list).getAllByRole("listitem").filter((li) => li.querySelector("fieldset"));
        expect(items).toHaveLength(3);
        expect(screen.getByText("Pages 1–3")).toBeInTheDocument();
        expect(screen.getByText("Page 4")).toBeInTheDocument();
        expect(screen.getByText("Pages 5–6")).toBeInTheDocument();
        expect(screen.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);
        expect(screen.getByDisplayValue("Constancia de situación fiscal — GACM701119BH5")).toBeInTheDocument();
        expect(screen.getByText("LandingAI charged 15.9 credits for this proposal. Adjusting it is free.")).toBeInTheDocument();
        expect(screen.getByText("The original doesn’t change. Each new document is a PDF with the original pages, in the same folder.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create 3 documents" })).toBeEnabled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("changing the type renames the group until the name has been typed", async () => {
        await reachPreview();
        const types = screen.getAllByLabelText("Type");
        await userEvent.selectOptions(types[0], "Constancia de situación fiscal");
        expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Constancia de situación fiscal");
        await userEvent.selectOptions(types[0], "");
        expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Document");
        const name = screen.getAllByLabelText("Name")[0];
        await userEvent.clear(name);
        await userEvent.type(name, "Mi poder");
        await userEvent.selectOptions(types[0], "Poder o documento de personalidad");
        expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Mi poder");
    });

    it("moves a page to another group and to a new one", async () => {
        await reachPreview();
        // Page 3 of the first document goes to the second.
        await userEvent.selectOptions(screen.getByLabelText("Move page 3 to"), "2");
        expect(screen.getByText("Pages 1–2")).toBeInTheDocument();
        expect(screen.getByText("Pages 3–4")).toBeInTheDocument();
        // Page 6 becomes a document of its own.
        await userEvent.selectOptions(screen.getByLabelText("Move page 6 to"), "new");
        expect(screen.getByRole("button", { name: "Create 4 documents" })).toBeEnabled();
    });

    it("splits a group before a page", async () => {
        await reachPreview();
        await userEvent.selectOptions(screen.getAllByLabelText("Split before")[0], "2");
        expect(screen.getByText("Page 1")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create 4 documents" })).toBeEnabled();
        // A one-page group cannot be split or emptied.
        expect(screen.queryByLabelText("Move page 4 to")?.querySelector("option[value='new']")).toBeNull();
    });

    it("leaves out an unchecked group and cannot create with nothing checked or a name missing", async () => {
        await reachPreview();
        await userEvent.click(screen.getByRole("checkbox", { name: "Create document 3" }));
        expect(screen.getByRole("button", { name: "Create 2 documents" })).toBeEnabled();
        await userEvent.clear(screen.getAllByLabelText("Name")[0]);
        expect(screen.getByRole("button", { name: "Create 2 documents" })).toBeDisabled();
        expect(screen.getAllByLabelText("Name")[0]).toHaveAttribute("aria-invalid", "true");
        await userEvent.type(screen.getAllByLabelText("Name")[0], "Poder");
        await userEvent.click(screen.getByRole("checkbox", { name: "Create document 1" }));
        await userEvent.click(screen.getByRole("checkbox", { name: "Create document 2" }));
        expect(screen.getByRole("button", { name: "Create documents" })).toBeDisabled();
    });
});

describe("creating the documents", () => {
    it("sends the version of the proposal and only the checked groups, then hands over the result", async () => {
        const onCreated = vi.fn();
        await reachPreview({ onCreated });
        await userEvent.click(screen.getByRole("checkbox", { name: "Create document 3" }));
        await userEvent.click(screen.getByRole("button", { name: "Create 2 documents" }));
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
        expect(mocks.create).toHaveBeenCalledWith("doc-1", "v1", [
            { pages: [1, 2, 3], name: "Poder o documento de personalidad", type: "Poder o documento de personalidad" },
            { pages: [4], name: "Constancia de situación fiscal — GACM701119BH5", type: "Constancia de situación fiscal" },
        ]);
    });

    it("is locked while creating", async () => {
        let finish: (value: typeof CREATED) => void = () => {};
        mocks.create.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const onClose = vi.fn();
        await reachPreview({ onClose });
        await userEvent.click(screen.getByRole("button", { name: "Create 3 documents" }));
        expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
        await userEvent.keyboard("{Escape}");
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getAllByLabelText("Name")[0]).toBeDisabled();
        finish(CREATED);
    });

    it("reports a failure with a retry and keeps the preview", async () => {
        const failure = new Error("boom");
        mocks.create.mockRejectedValueOnce(failure);
        const onCreated = vi.fn();
        await reachPreview({ onCreated });
        await userEvent.click(screen.getByRole("button", { name: "Create 3 documents" }));
        await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
        const [error, options] = mocks.notify.mock.calls[0];
        expect(error).toBe(failure);
        expect(options.action).toBe("create the documents");
        expect(screen.getByRole("button", { name: "Create 3 documents" })).toBeEnabled();
        await options.onRetry();
        expect(onCreated).toHaveBeenCalledWith(CREATED);
    });

    it("ignores a result that arrives after the dialog was closed", async () => {
        let finish: (value: typeof CREATED) => void = () => {};
        mocks.create.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const onCreated = vi.fn();
        const view = render(<SplitDocumentModal request={request} onClose={vi.fn()} onCreated={onCreated} />);
        await screen.findByText(/Estimated cost/);
        await userEvent.click(proposeButton());
        await screen.findByLabelText("Proposed documents");
        await userEvent.click(screen.getByRole("button", { name: "Create 3 documents" }));
        view.unmount();
        finish(CREATED);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(onCreated).not.toHaveBeenCalled();
    });
});

describe("the legal notice in the catalog", () => {
    it("has the final text of socium-legal (t_a4651c51) under its own keys, in both languages", () => {
        expect(esMX.documents.split.notice).toBe(
            "Si continúas, LiTT enviará el texto completo de este documento a LandingAI, en Estados Unidos, con tu llave o la de tu despacho, y LandingAI te cobrará alrededor de 0.01 USD por cada 5,000 caracteres.",
        );
        expect(esMX.documents.split.noticeDetail).toBe(
            "Si tu plan con LandingAI no tiene retención cero (solo en sus planes Team y Enterprise), LandingAI puede conservar el texto y usarlo para mejorar sus productos y entrenar sus modelos; LiTT no controla ni responde por lo que haga con él.",
        );
        expect(enUS.documents.split.notice).toBe(
            "If you continue, LiTT will send the full text of this document to LandingAI, in the United States, using your key or your firm's, and LandingAI will charge you about USD 0.01 per 5,000 characters.",
        );
        expect(enUS.documents.split.noticeDetail).toBe(
            "If your LandingAI plan has no zero data retention (offered only on its Team and Enterprise plans), LandingAI may keep the text and use it to improve its products and train its models; LiTT does not control and is not responsible for what it does with it.",
        );
    });

    it("renders in Spanish", async () => {
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <SplitDocumentModal request={request} onClose={vi.fn()} onCreated={vi.fn()} />
            </IntlClientProvider>,
        );
        expect(await screen.findByText(/Si continúas, LiTT enviará el texto completo/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Enviar y proponer la separación" })).toBeEnabled();
        expect(screen.getByText("6 páginas. Costo estimado: 15.9 créditos de LandingAI, alrededor de 0.16 USD.")).toBeInTheDocument();
    });
});

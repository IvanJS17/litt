import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterRequestDetail, MatterRequestList } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { MatterRequests } from "./MatterRequests";

const mocks = vi.hoisted(() => ({
  listMatterRequests: vi.fn(),
  getMatterRequest: vi.fn(),
  createMatterRequest: vi.fn(),
  updateMatterRequest: vi.fn(),
  linkMatterRequestRound: vi.fn(),
  unlinkMatterRequestRound: vi.fn(),
  setMatterRetainer: vi.fn(),
  getProject: vi.fn(),
  listDocumentVersions: vi.fn(),
  notifyError: vi.fn(),
  getTriageCard: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  listMatterRequests: mocks.listMatterRequests,
  getMatterRequest: mocks.getMatterRequest,
  createMatterRequest: mocks.createMatterRequest,
  updateMatterRequest: mocks.updateMatterRequest,
  linkMatterRequestRound: mocks.linkMatterRequestRound,
  unlinkMatterRequestRound: mocks.unlinkMatterRequestRound,
  setMatterRetainer: mocks.setMatterRetainer,
  getProject: mocks.getProject,
  listDocumentVersions: mocks.listDocumentVersions,
  getTriageCard: mocks.getTriageCard,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
}));

const TYPE_A = "type-a";
const TYPE_B = "type-b";
const ANA = "user-ana";
const LUIS = "user-luis";

const row = (over: Partial<MatterRequestDetail> = {}) => ({
  id: "req-1",
  matter_id: "matter-1",
  type_id: TYPE_A,
  title: "Contrato de arrendamiento",
  complexity: "standard" as const,
  status: "received" as const,
  assignee_user_id: null,
  assignee_level: null,
  received_on: "2026-11-02",
  closed_on: null,
  round_count: 0,
  version: 1,
  created_at: "2026-11-02T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  ...over,
});
const detail = (over: Partial<MatterRequestDetail> = {}): MatterRequestDetail => ({
  ...row(),
  rounds: [],
  events: [{ id: "e1", actor_user_id: ANA, action: "created", detail: {}, created_at: "2026-11-02T10:00:00Z" }],
  ...over,
});
const list = (over: Partial<MatterRequestList> = {}): MatterRequestList => ({
  retainer: true,
  can_manage_retainer: true,
  can_write: true,
  requests: [row()],
  types: [
    { id: TYPE_A, seed_key: "contracts_clients", name: null, sort_order: 10, archived: false },
    { id: TYPE_B, seed_key: null, name: "Poderes notariales", sort_order: 20, archived: false },
  ],
  assignees: [
    { user_id: ANA, display_name: "Ana Pérez", email: "ana@example.test", role: "matter_owner", suggested_level: "partner" },
    { user_id: LUIS, display_name: "Luis Soto", email: "luis@example.test", role: "editor", suggested_level: "apprentice" },
  ],
  ...over,
});

const renderPage = () => render(<MatterRequests projectId="project-1" matterId="matter-1" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listMatterRequests.mockResolvedValue(list());
  mocks.getMatterRequest.mockResolvedValue(detail());
  mocks.getTriageCard.mockResolvedValue({
    enabled: false,
    can_decide: false,
    pending: false,
    usage: { used: 0, limit: 1000 },
    run: null,
    items: [],
    playbooks: [],
  });
  mocks.getProject.mockResolvedValue({ documents: [{ id: "doc-1", filename: "Arrendamiento.docx", status: "ready" }] });
  mocks.listDocumentVersions.mockResolvedValue({
    current_version_id: "ver-2",
    versions: [
      { id: "ver-1", version_number: 1, filename: "Arrendamiento.docx", source: "upload", created_at: "2026-11-01T00:00:00Z" },
      { id: "ver-2", version_number: 2, filename: "Arrendamiento v2.docx", source: "upload", created_at: "2026-11-03T00:00:00Z" },
    ],
  });
});

describe("MatterRequests", () => {
  it("shows a loading state of the list's shape, then the requests in plain text", async () => {
    let resolve!: (value: MatterRequestList) => void;
    mocks.listMatterRequests.mockReturnValue(new Promise((done) => (resolve = done)));
    renderPage();
    expect(screen.getByLabelText("Loading requests")).toHaveAttribute("aria-busy", "true");
    resolve(list({ requests: [row({ assignee_user_id: ANA, assignee_level: "partner", round_count: 2 })] }));
    const item = await screen.findByRole("button", { name: /Contrato de arrendamiento/ });
    expect(item).toHaveTextContent("Contracts with clients · Standard · Received");
    expect(item).toHaveTextContent("Ana Pérez (Partner) · 2 rounds");
    expect(screen.queryByLabelText("Loading requests")).not.toBeInTheDocument();
  });

  it("lets a long title wrap instead of cutting it", async () => {
    const long = "Contrato marco de prestación de servicios profesionales ".repeat(6).trim() + "X".repeat(60);
    mocks.listMatterRequests.mockResolvedValue(list({ requests: [row({ title: long })] }));
    renderPage();
    const item = await screen.findByRole("button", { name: new RegExp(long.slice(0, 40)) });
    expect(within(item).getByText(long)).toHaveClass("break-words");
    expect(item.className).not.toMatch(/truncate/);
  });

  it("filters open and finished requests", async () => {
    mocks.listMatterRequests.mockResolvedValue(
      list({ requests: [row(), row({ id: "req-2", title: "Acta cerrada", status: "closed", closed_on: "2026-11-09" })] }),
    );
    renderPage();
    await screen.findByText("Acta cerrada");
    await userEvent.selectOptions(screen.getByLabelText("Show"), "open");
    expect(screen.queryByText("Acta cerrada")).not.toBeInTheDocument();
    expect(screen.getByText("Contrato de arrendamiento")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Show"), "finished");
    expect(screen.getByText("Acta cerrada")).toBeInTheDocument();
    expect(screen.queryByText("Contrato de arrendamiento")).not.toBeInTheDocument();
  });

  it("explains an empty retainer differently to who can and cannot write", async () => {
    mocks.listMatterRequests.mockResolvedValue(list({ requests: [] }));
    const { unmount } = renderPage();
    expect(await screen.findByText("Create the first request of this retainer.")).toBeInTheDocument();
    unmount();
    mocks.listMatterRequests.mockResolvedValue(list({ requests: [], can_write: false, can_manage_retainer: false }));
    renderPage();
    expect(await screen.findByText("Nobody has created a request in this matter yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New request" })).not.toBeInTheDocument();
  });

  it("offers the owner to mark a matter that is not a retainer, and nobody else", async () => {
    mocks.listMatterRequests.mockResolvedValue(list({ retainer: false, requests: [], types: [], assignees: [], can_write: false }));
    mocks.setMatterRetainer.mockResolvedValue({ matter_id: "matter-1", is_retainer: true });
    const { unmount } = renderPage();
    mocks.listMatterRequests.mockResolvedValue(list());
    await userEvent.click(await screen.findByRole("button", { name: "Mark as retainer" }));
    expect(mocks.setMatterRetainer).toHaveBeenCalledWith("project-1", "matter-1", true);
    expect(await screen.findByRole("button", { name: /Contrato de arrendamiento/ })).toBeInTheDocument();
    unmount();

    mocks.listMatterRequests.mockResolvedValue(
      list({ retainer: false, can_manage_retainer: false, requests: [], types: [], assignees: [], can_write: false }),
    );
    renderPage();
    expect(await screen.findByText(/Ask the matter owner to mark it as a retainer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as retainer" })).not.toBeInTheDocument();
  });

  it("says why a retainer with requests cannot be unmarked", async () => {
    mocks.setMatterRetainer.mockRejectedValue({ code: "retainer_has_requests" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Stop treating this matter as a retainer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This matter already has requests, so it stays a retainer.");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("creates a request, suggesting the level of the person chosen", async () => {
    mocks.createMatterRequest.mockResolvedValue(
      detail({ id: "req-9", title: "Asamblea anual", type_id: TYPE_B, complexity: "complex", assignee_user_id: LUIS, assignee_level: "apprentice" }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New request" }));
    const create = screen.getByRole("button", { name: "Create request" });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Title"), "Asamblea anual");
    await userEvent.selectOptions(screen.getByLabelText("Type"), TYPE_B);
    await userEvent.selectOptions(screen.getByLabelText("Complexity"), "complex");
    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), LUIS);
    expect(screen.getByLabelText("Cost level")).toHaveValue("apprentice");
    await userEvent.click(create);
    expect(mocks.createMatterRequest).toHaveBeenCalledWith("project-1", "matter-1", {
      title: "Asamblea anual",
      type_id: TYPE_B,
      complexity: "complex",
      assignee_user_id: LUIS,
      assignee_level: "apprentice",
    });
    expect(await screen.findByRole("heading", { name: "Asamblea anual" })).toBeInTheDocument();
    expect(screen.getAllByText(/Asamblea anual/).length).toBeGreaterThan(1);
  });

  it("blocks an assignee without a cost level and offers no time field anywhere", async () => {
    mocks.listMatterRequests.mockResolvedValue(
      list({ assignees: [{ user_id: ANA, display_name: "Ana Pérez", email: null, role: "editor", suggested_level: null }] }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New request" }));
    await userEvent.type(screen.getByLabelText("Title"), "Poder");
    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), ANA);
    expect(screen.getByRole("button", { name: "Create request" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Cost level"), "senior");
    expect(screen.getByRole("button", { name: "Create request" })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/\bhours?\b|\bminutes?\b|estimate/i);
  });

  it("changes the state and sends only what changed, with the version read", async () => {
    mocks.updateMatterRequest.mockResolvedValue(detail({ status: "with_client", version: 2 }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Contrato de arrendamiento/ }));
    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("State"), "with_client");
    await userEvent.click(save);
    expect(mocks.updateMatterRequest).toHaveBeenCalledWith("project-1", "matter-1", "req-1", { status: "with_client", version: 1 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Contrato de arrendamiento/ })).toHaveTextContent("With the client"),
    );
  });

  it("tells the person when another change came first, and shows the latest", async () => {
    mocks.updateMatterRequest.mockRejectedValue({ code: "request_version_conflict" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Contrato de arrendamiento/ }));
    mocks.getMatterRequest.mockResolvedValue(detail({ title: "Contrato (otra persona)", version: 2 }));
    await userEvent.selectOptions(await screen.findByLabelText("Complexity"), "complex");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone changed this request while you were editing");
    expect(await screen.findByRole("heading", { name: "Contrato (otra persona)" })).toBeInTheDocument();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("shows a viewer the request read only", async () => {
    mocks.listMatterRequests.mockResolvedValue(list({ can_write: false, can_manage_retainer: false, assignees: [] }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Contrato de arrendamiento/ }));
    expect(await screen.findByLabelText("Complexity")).toBeDisabled();
    expect(screen.getByLabelText("State")).toBeDisabled();
    expect(screen.getByLabelText("Title", { selector: "input" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link as a round" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the matter owner and editors change it/)).toBeInTheDocument();
  });

  it("links a document version as a round, and unlinks one", async () => {
    mocks.getMatterRequest.mockResolvedValue(detail());
    mocks.linkMatterRequestRound.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Contrato de arrendamiento/ }));
    expect(await screen.findByText("No document version is linked to this request yet.")).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText("Document"), "doc-1");
    await userEvent.selectOptions(await screen.findByLabelText("Version"), "ver-2");
    expect(screen.getByRole("button", { name: "Link as a round" })).toBeEnabled();
    mocks.getMatterRequest.mockResolvedValue(
      detail({
        round_count: 1,
        version: 1,
        rounds: [{ id: "round-1", round_number: 1, round_date: "2026-11-03", document_id: "doc-1", version_id: "ver-2", version_number: 2, filename: "Arrendamiento v2.docx" }],
      }),
    );
    await userEvent.type(screen.getByLabelText("Round number"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Link as a round" }));
    expect(mocks.linkMatterRequestRound).toHaveBeenCalledWith("project-1", "matter-1", "req-1", { version_id: "ver-2", round_number: 1 });
    expect(await screen.findByText(/Round 1, Nov 3, 2026: Arrendamiento v2\.docx \(version 2\)/)).toBeInTheDocument();
    expect(screen.getAllByText("1 round").length).toBeGreaterThan(0);

    mocks.unlinkMatterRequestRound.mockResolvedValue({ removed: true });
    mocks.getMatterRequest.mockResolvedValue(detail());
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(mocks.unlinkMatterRequestRound).toHaveBeenCalledWith("project-1", "matter-1", "req-1", "round-1");
    expect(await screen.findByText("No document version is linked to this request yet.")).toBeInTheDocument();
  });

  it("says when a version is already a round, without an error popup", async () => {
    mocks.linkMatterRequestRound.mockRejectedValue({ code: "round_already_linked" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Contrato de arrendamiento/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Document"), "doc-1");
    await userEvent.selectOptions(await screen.findByLabelText("Version"), "ver-1");
    await userEvent.click(screen.getByRole("button", { name: "Link as a round" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That version is already a round of this request.");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    mocks.listMatterRequests.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the requests.");
    expect(mocks.notifyError).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Contrato de arrendamiento/ })).toBeInTheDocument();
  });

  it("speaks Spanish with the retainer vocabulary and no hours", async () => {
    mocks.getMatterRequest.mockResolvedValue(detail({ status: "with_counterparty", complexity: "complex" }));
    mocks.listMatterRequests.mockResolvedValue(
      list({ requests: [row({ status: "with_counterparty", complexity: "complex", round_count: 3, assignee_user_id: ANA, assignee_level: "senior" })] }),
    );
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <MatterRequests projectId="project-1" matterId="matter-1" />
      </IntlClientProvider>,
    );
    const item = await screen.findByRole("button", { name: /Contrato de arrendamiento/ });
    expect(item).toHaveTextContent("Contratos con clientes · Compleja · Con la contraparte");
    expect(item).toHaveTextContent("Ana Pérez (Sénior) · 3 rondas");
    expect(screen.getByRole("heading", { name: "Solicitudes" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bhoras?\b|\bminutos?\b|estimaci/i);
  });
});

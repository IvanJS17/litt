import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterRequestDetail, TriageCard as TriageCardData, TriageItem } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { TriageCard } from "./TriageCard";

const mocks = vi.hoisted(() => ({
  getTriageCard: vi.fn(),
  runTriage: vi.fn(),
  decideTriageItem: vi.fn(),
  getMatterRequest: vi.fn(),
  notifyError: vi.fn(),
  onChanged: vi.fn(),
  onStale: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getTriageCard: mocks.getTriageCard,
  runTriage: mocks.runTriage,
  decideTriageItem: mocks.decideTriageItem,
  getMatterRequest: mocks.getMatterRequest,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
}));

const TYPE_A = "type-a";
const TYPE_B = "type-b";
const ANA = "user-ana";
const types = [
  { id: TYPE_A, seed_key: "contracts_clients" as const, name: null, sort_order: 10, archived: false },
  { id: TYPE_B, seed_key: null, name: "Poderes notariales", sort_order: 20, archived: false },
];
const assignees = [{ user_id: ANA, display_name: "Ana Pérez", email: "ana@example.test", role: "matter_owner" as const, suggested_level: "partner" as const }];
const request = {
  id: "req-1", matter_id: "m-1", type_id: TYPE_A, title: "Contrato de arrendamiento", complexity: "standard", status: "received",
  assignee_user_id: null, assignee_level: null, received_on: "2026-11-02", closed_on: null, round_count: 0, version: 3,
  created_at: "2026-11-02T10:00:00Z", updated_at: "2026-11-02T10:00:00Z", rounds: [], events: [],
} as MatterRequestDetail;

const item = (over: Partial<TriageItem>): TriageItem => ({
  id: "i-0", kind: "strategy", position: 0, type_id: null, enum_value: null, user_id: null, user_label: null,
  text: null, purpose: null, playbook: null, confidence: null, low_confidence: false, forced_by_alarm: false, cited: false, decision: null,
  ...over,
});
const card = (over: Partial<TriageCardData> = {}): TriageCardData => ({
  enabled: true,
  can_decide: true,
  pending: false,
  usage: { used: 3, limit: 1000 },
  run: {
    id: "run-1", trigger: "auto", created_at: "2026-11-02T10:00:00Z", classify_status: "ok", generative_status: "ok",
    docs_total: 1, docs_read: 1, docs_partial: 0, unread: [], quotes_rejected: 0,
  },
  items: [
    item({ id: "i-type", kind: "type", type_id: TYPE_B, confidence: 0.9 }),
    item({ id: "i-complexity", kind: "complexity", enum_value: "complex", confidence: 0.8, low_confidence: true }),
    item({ id: "i-urgency", kind: "urgency", enum_value: "urgent", forced_by_alarm: true }),
    item({ id: "i-candidate", kind: "candidate", user_id: ANA, user_label: "Ana Pérez" }),
    item({ id: "i-s1", kind: "strategy", text: "Revisar la cláusula de rescisión", cited: true }),
    item({ id: "i-q1", kind: "question", text: "¿Hay anexos firmados?" }),
    item({ id: "i-d1", kind: "document", text: "Respuesta al cliente", purpose: "Contestar la consulta", playbook: { id: "p1", name: "Playbook laboral" } }),
  ],
  playbooks: [{ id: "p1", name: "Playbook laboral" }],
  ...over,
});

const renderCard = () =>
  render(
    <TriageCard projectId="p-1" matterId="m-1" request={request} types={types} assignees={assignees} onChanged={mocks.onChanged} onStale={mocks.onStale} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTriageCard.mockResolvedValue(card());
  mocks.getMatterRequest.mockResolvedValue(request);
});

describe("TriageCard", () => {
  it("shows a loading state of its own shape, then what Donna proposed as plain text", async () => {
    let resolve!: (value: TriageCardData) => void;
    mocks.getTriageCard.mockReturnValue(new Promise((done) => (resolve = done)));
    const { container } = renderCard();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    resolve(card());
    expect(await screen.findByText(/Poderes notariales/)).toBeInTheDocument();
    expect(screen.getByText(/Complexity:/).closest("li")).toHaveTextContent("Complex · low confidence");
    expect(screen.getByText(/Urgency:/).closest("li")).toHaveTextContent("Urgent · urgent because of an alarm word");
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(screen.getByText("Revisar la cláusula de rescisión")).toBeInTheDocument();
    expect(screen.getByText(/¿Hay anexos firmados\?/)).toBeInTheDocument();
    expect(screen.getByText(/Respuesta al cliente/).closest("li")).toHaveTextContent("playbook: Playbook laboral");
    expect(screen.getByText("Read 1 of 1 documents.")).toBeInTheDocument();
    expect(screen.getByText("Playbooks linked to the type: Playbook laboral")).toBeInTheDocument();
    expect(screen.getByText("Firm runs this month: 3 of 1000")).toBeInTheDocument();
  });

  it("accepts a type through the request's version, then reads the request again", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.decideTriageItem.mockResolvedValue(card({ items: card().items.map((one) => (one.id === "i-type" ? { ...one, decision: { action: "accepted", actor_user_id: ANA, created_at: "x", edited_type_id: null, edited_enum: null, edited_user_id: null, edited_text: null, edited_purpose: null } } : one)) }));
    renderCard();
    const row = (await screen.findByText(/Poderes notariales/)).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(mocks.decideTriageItem).toHaveBeenCalledWith("p-1", "m-1", "req-1", "i-type", { action: "accepted", version: 3 }));
    await waitFor(() => expect(mocks.getMatterRequest).toHaveBeenCalledWith("p-1", "m-1", "req-1"));
    expect(mocks.onChanged).toHaveBeenCalled();
    expect(await within(row).findByText("Accepted")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });

  it("edits a complexity from the closed list, and a draft with the lawyer's own words", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.decideTriageItem.mockResolvedValue(card());
    renderCard();
    const complexity = (await screen.findByText(/Complexity:/)).closest("li")!;
    await user.click(within(complexity).getByRole("button", { name: "Edit" }));
    await user.selectOptions(within(complexity).getByLabelText("Complexity"), "routine");
    await user.click(within(complexity).getByRole("button", { name: "Save change" }));
    await waitFor(() =>
      expect(mocks.decideTriageItem).toHaveBeenCalledWith("p-1", "m-1", "req-1", "i-complexity", { action: "edited", complexity: "routine", version: 3 }),
    );
    const step = screen.getByText("Revisar la cláusula de rescisión").closest("li")!;
    await user.click(within(step).getByRole("button", { name: "Edit" }));
    const field = within(step).getByLabelText("Text");
    await user.clear(field);
    await user.type(field, "Mi propio paso");
    await user.click(within(step).getByRole("button", { name: "Save change" }));
    await waitFor(() =>
      expect(mocks.decideTriageItem).toHaveBeenCalledWith("p-1", "m-1", "req-1", "i-s1", { action: "edited", text: "Mi propio paso" }),
    );
  });

  it("discards a question without touching the request", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.decideTriageItem.mockResolvedValue(card());
    renderCard();
    const question = (await screen.findByText(/¿Hay anexos firmados\?/)).closest("li")!;
    await user.click(within(question).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(mocks.decideTriageItem).toHaveBeenCalledWith("p-1", "m-1", "req-1", "i-q1", { action: "discarded" }));
    expect(mocks.getMatterRequest).not.toHaveBeenCalled();
  });

  it("tells the request is stale when another change came first", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.decideTriageItem.mockRejectedValue({ code: "request_version_conflict" });
    renderCard();
    const row = (await screen.findByText(/Poderes notariales/)).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(mocks.onStale).toHaveBeenCalled());
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("lets a person in training read the card and offers no way to decide or run", async () => {
    mocks.getTriageCard.mockResolvedValue(card({ can_decide: false }));
    renderCard();
    expect(await screen.findByText(/Poderes notariales/)).toBeInTheDocument();
    for (const name of ["Accept", "Edit", "Discard", "Analyse again"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByText(/up to a responsible lawyer/)).toBeInTheDocument();
  });

  it("says «clasificación no disponible» when Jev failed, and that no AI key means no drafts", async () => {
    mocks.getTriageCard.mockResolvedValue(
      card({
        items: [],
        run: { ...card().run!, classify_status: "unavailable", generative_status: "no_key" },
      }),
    );
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <TriageCard projectId="p-1" matterId="m-1" request={request} types={types} assignees={assignees} onChanged={mocks.onChanged} onStale={mocks.onStale} />
      </IntlClientProvider>,
    );
    expect(await screen.findByText(/Clasificación no disponible/)).toBeInTheDocument();
    expect(screen.getByText(/no tiene una llave de IA/)).toBeInTheDocument();
  });

  it("reports what was not read, and the points dropped for a citation that is not there", async () => {
    mocks.getTriageCard.mockResolvedValue(
      card({ run: { ...card().run!, docs_total: 3, docs_read: 1, docs_partial: 1, unread: [{ version_id: "v2", filename: "anexo.docx" }, { version_id: "v3", filename: null }], quotes_rejected: 2 } }),
    );
    renderCard();
    expect(await screen.findByText("Read 1 of 3 documents. One document was read only in part because of its size.")).toBeInTheDocument();
    expect(screen.getByText("Not read: anexo.docx, Untitled")).toBeInTheDocument();
    expect(screen.getByText("2 points were dropped because its citation is not in the document.")).toBeInTheDocument();
  });

  it("shows the states of a request with no run: analysing, off, and the cap", async () => {
    mocks.getTriageCard.mockResolvedValue(card({ run: null, items: [], pending: true }));
    const view = renderCard();
    expect(await screen.findByRole("status")).toHaveTextContent("Donna is analysing the request…");
    view.unmount();
    mocks.getTriageCard.mockResolvedValue(card({ run: null, items: [], enabled: false, can_decide: true }));
    const off = renderCard();
    expect(await screen.findByText(/Donna is off in this project/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyse now" })).not.toBeInTheDocument();
    off.unmount();
    mocks.getTriageCard.mockResolvedValue(card({ run: null, items: [], usage: { used: 1000, limit: 1000 } }));
    renderCard();
    expect(await screen.findByText(/monthly limit for this firm has been reached/)).toBeInTheDocument();
  });

  it("shows the cap message when a new run is refused with 429, and no error popup", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.runTriage.mockRejectedValue({ code: "donna_monthly_cap" });
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Analyse again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("monthly limit for this firm has been reached");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("offers to retry when the card cannot be loaded", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.getTriageCard.mockRejectedValueOnce(new Error("down"));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Poderes notariales/)).toBeInTheDocument();
  });
});

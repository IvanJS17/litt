import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterRadar as MatterRadarData, RadarItem } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { MatterRadar } from "./MatterRadar";

const mocks = vi.hoisted(() => ({
  getMatterRadar: vi.fn(),
  actOnRadarItem: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getMatterRadar: mocks.getMatterRadar,
  actOnRadarItem: mocks.actOnRadarItem,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
}));

const ANA = "user-ana";
const QUOTE = "La vigencia vence el 31 de diciembre de 2026, con treinta días de aviso.";

const item = (over: Partial<RadarItem> = {}): RadarItem => ({
  key: "fact-1:notice",
  fact_id: "fact-1",
  type: "notice",
  label: "Vigencia del arrendamiento",
  due_on: "2026-12-01",
  days_left: 15,
  bucket: "next_30",
  review_reason: null,
  base_on: "2026-12-31",
  notice_days: 30,
  rule_text: null,
  state: "open",
  acted_by: null,
  acted_at: null,
  reason: null,
  source: {
    document_id: "doc-1",
    version_id: "ver-1",
    version_number: 2,
    filename: "contrato.docx",
    start_char: 0,
    end_char: 10,
    quote: QUOTE,
    text_sha256: "a".repeat(64),
  },
  ...over,
});
const radar = (over: Partial<MatterRadarData> = {}): MatterRadarData => ({
  retainer: true,
  can_write: true,
  today: "2026-11-16",
  time_zone: "America/Mexico_City",
  items: [item()],
  people: [{ user_id: ANA, name: "Ana Pérez" }],
  ...over,
});

const renderPage = () => render(<MatterRadar projectId="project-1" matterId="matter-1" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMatterRadar.mockResolvedValue(radar());
  mocks.actOnRadarItem.mockResolvedValue(item());
});

describe("MatterRadar", () => {
  it("shows a loading state, the mandatory planning notice and the matter navigation", async () => {
    let resolve!: (value: MatterRadarData) => void;
    mocks.getMatterRadar.mockReturnValue(new Promise((done) => (resolve = done)));
    renderPage();
    expect(screen.getByLabelText("Loading the deadline radar")).toHaveAttribute("aria-busy", "true");
    resolve(radar());
    await screen.findByRole("article");
    expect(screen.queryByLabelText("Loading the deadline radar")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deadline radar" })).toBeInTheDocument();
    expect(screen.getByText("Planning aid. The date is not a legal deadline and LiTT does not calculate procedural deadlines.")).toBeInTheDocument();
    expect(screen.getByText(/Days are counted as calendar days, with today's date in Mexico City\. Today is Nov 16, 2026/)).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Matter sections" });
    expect(within(nav).getByRole("link", { name: "Radar" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Client profile" })).toHaveAttribute("href", "/projects/project-1/matters/matter-1/profile");
    expect(within(nav).getByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(getComputedStyle(document.body).display).toBeDefined();
  });

  it("groups the items: overdue, next 30 days, later and to review, with the handled ones last", async () => {
    mocks.getMatterRadar.mockResolvedValue(
      radar({
        items: [
          item({ key: "a:notice", label: "Vencido", due_on: "2026-11-10", days_left: -6, bucket: "overdue" }),
          item({ key: "b:notice", label: "Pronto" }),
          item({ key: "c:expiry", type: "expiry", label: "Lejano", due_on: "2028-02-29", days_left: 470, bucket: "later" }),
          item({ key: "d:notice", label: "Hábiles", due_on: null, days_left: null, bucket: "review", review_reason: "business_days", base_on: null, notice_days: 10 }),
          item({ key: "e:expiry", type: "expiry", label: "Hecho", bucket: "next_30", state: "done", acted_by: ANA, acted_at: "2026-11-16T10:00:00Z" }),
        ],
      }),
    );
    renderPage();
    await screen.findByRole("article", { name: "Pronto" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Overdue", "Next 30 days", "Later", "To review", "Handled"]);
    expect(screen.getByRole("article", { name: "Vencido" })).toHaveTextContent("Nov 10, 2026 · Expired 6 days ago");
    expect(screen.getByRole("article", { name: "Pronto" })).toHaveTextContent("Dec 1, 2026 · In 15 days");
    expect(screen.getByRole("article", { name: "Pronto" })).toHaveTextContent("Calculated: Dec 31, 2026 minus 30 calendar days");
    expect(screen.getByRole("article", { name: "Pronto" })).toHaveTextContent("Last day to give notice");
    expect(screen.getByRole("article", { name: "Lejano" })).toHaveTextContent("Expiry");
    const review = screen.getByRole("article", { name: "Hábiles" });
    expect(review).toHaveTextContent("The notice is in business days and LiTT does not calculate them.");
    expect(review).toHaveTextContent("Notice: 10 business days");
    // No date is shown for it: nothing was computed.
    expect(review).not.toHaveTextContent(/[A-Z][a-z]{2} \d{1,2}, 20\d\d/);
    const done = screen.getByRole("article", { name: "Hecho" });
    expect(done).toHaveTextContent("Done by Ana Pérez on");
    expect(within(done).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says today for the exact day and one day for singular counts", async () => {
    mocks.getMatterRadar.mockResolvedValue(
      radar({
        items: [
          item({ key: "a:expiry", type: "expiry", label: "Hoy mismo", due_on: "2026-11-16", days_left: 0 }),
          item({ key: "b:expiry", type: "expiry", label: "Mañana", due_on: "2026-11-17", days_left: 1 }),
          item({ key: "c:expiry", type: "expiry", label: "Ayer", due_on: "2026-11-15", days_left: -1, bucket: "overdue" }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByRole("article", { name: "Hoy mismo" })).toHaveTextContent("Nov 16, 2026 · Today");
    expect(screen.getByRole("article", { name: "Mañana" })).toHaveTextContent("In 1 day");
    expect(screen.getByRole("article", { name: "Ayer" })).toHaveTextContent("Expired 1 day ago");
  });

  it("shows each item with the fact's quote, its source version and the rule in words", async () => {
    mocks.getMatterRadar.mockResolvedValue(radar({ items: [item({ rule_text: "noventa días de aviso", base_on: null, notice_days: null, due_on: "2026-12-31", type: "expiry" })] }));
    renderPage();
    const card = await screen.findByRole("article", { name: "Vigencia del arrendamiento" });
    expect(within(card).getByText(QUOTE)).toBeInTheDocument();
    expect(card).toHaveTextContent("Source: contrato.docx, version 2");
    expect(card).toHaveTextContent("Rule in the document: noventa días de aviso");
    expect(within(card).getByRole("link", { name: "See it in the client profile" })).toHaveAttribute("href", "/projects/project-1/matters/matter-1/profile");
  });

  it("names a source that no longer exists, a deleted account and a missing date", async () => {
    mocks.getMatterRadar.mockResolvedValue(
      radar({
        items: [
          item({
            key: "x:notice",
            label: "Sin fecha",
            due_on: null,
            days_left: null,
            bucket: "review",
            review_reason: "missing_date",
            base_on: null,
            notice_days: null,
            state: "dismissed",
            acted_by: "gone",
            acted_at: "2026-11-16T10:00:00Z",
            reason: "No aplica",
            source: { ...item().source, version_number: null, filename: null },
          }),
        ],
        people: [],
      }),
    );
    renderPage();
    const card = await screen.findByRole("article", { name: "Sin fecha" });
    expect(card).toHaveTextContent("Source: A version that no longer exists");
    expect(card).toHaveTextContent("The fact has no date to count from.");
    expect(card).toHaveTextContent("Dismissed by Deleted user on");
    expect(card).toHaveTextContent("Reason: No aplica");
  });

  it("acknowledges and completes an item, then reads the radar again", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByRole("article");
    mocks.getMatterRadar.mockResolvedValue(radar({ items: [item({ state: "acknowledged", acted_by: ANA, acted_at: "2026-11-16T10:00:00Z" })] }));
    await user.click(within(card).getByRole("button", { name: "Mark as seen" }));
    expect(mocks.actOnRadarItem).toHaveBeenCalledWith("project-1", "matter-1", "fact-1:notice", "ack", {});
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("Seen by Ana Pérez on"));
    // Once seen, only "done" and "dismiss" remain.
    expect(screen.queryByRole("button", { name: "Mark as seen" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(mocks.actOnRadarItem).toHaveBeenLastCalledWith("project-1", "matter-1", "fact-1:notice", "done", {});
    expect(mocks.getMatterRadar).toHaveBeenCalledTimes(3);
  });

  it("will not dismiss without a reason, and sends the trimmed reason", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByRole("article");
    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    await user.click(within(card).getByRole("button", { name: "Dismiss the deadline" }));
    expect(within(card).getByRole("alert")).toHaveTextContent("Write the reason to dismiss it.");
    expect(within(card).getByLabelText("Reason (required)")).toBeInvalid();
    expect(mocks.actOnRadarItem).not.toHaveBeenCalled();
    await user.type(within(card).getByLabelText("Reason (required)"), "  Ya renovó  ");
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Dismiss the deadline" }));
    expect(mocks.actOnRadarItem).toHaveBeenCalledWith("project-1", "matter-1", "fact-1:notice", "dismiss", { reason: "Ya renovó" });
  });

  it("cancelling a dismissal clears the reason", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByRole("article");
    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    await user.type(within(card).getByLabelText("Reason (required)"), "x");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByLabelText("Reason (required)")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(within(card).getByLabelText("Reason (required)")).toHaveValue("");
  });

  it("reports a failed action, and reloads when somebody else handled the item", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article");
    mocks.actOnRadarItem.mockRejectedValueOnce(new Error("down"));
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The action could not be recorded." });
    expect(mocks.getMatterRadar).toHaveBeenCalledTimes(1);
    mocks.actOnRadarItem.mockRejectedValueOnce(Object.assign(new Error("late"), { code: "radar_item_closed" }));
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(mocks.notifyError).toHaveBeenLastCalledWith(expect.any(Error), { action: "Somebody else already handled this deadline. The radar was reloaded." });
    await waitFor(() => expect(mocks.getMatterRadar).toHaveBeenCalledTimes(2));
  });

  it("gives a viewer the items and no way to act", async () => {
    mocks.getMatterRadar.mockResolvedValue(radar({ can_write: false }));
    renderPage();
    const card = await screen.findByRole("article");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the empty state, the not-a-retainer state and a failed load with retry", async () => {
    mocks.getMatterRadar.mockResolvedValue(radar({ items: [] }));
    const first = renderPage();
    expect(await screen.findByText("No confirmed deadlines")).toBeInTheDocument();
    first.unmount();

    mocks.getMatterRadar.mockResolvedValue(radar({ retainer: false, items: [] }));
    const second = renderPage();
    expect(await screen.findByText("This matter is not a retainer")).toBeInTheDocument();
    second.unmount();

    const user = userEvent.setup();
    mocks.getMatterRadar.mockRejectedValueOnce(new Error("down"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("The deadline radar could not be loaded.");
    expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The deadline radar could not be loaded." });
    mocks.getMatterRadar.mockResolvedValue(radar());
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article")).toBeInTheDocument();
  });

  it("reports a failed reload after an action without losing the page", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article");
    mocks.getMatterRadar.mockRejectedValueOnce(new Error("down"));
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The deadline radar could not be loaded." }));
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("ignores a reply that arrives after the page moved on", async () => {
    let resolve!: (value: MatterRadarData) => void;
    mocks.getMatterRadar.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = renderPage();
    view.unmount();
    resolve(radar());
    await Promise.resolve();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    mocks.getMatterRadar.mockRejectedValue(new Error("late"));
    const again = renderPage();
    again.unmount();
    await Promise.resolve();
  });

  it("reads in Spanish, with the planning notice and no hours", async () => {
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <MatterRadar projectId="project-1" matterId="matter-1" />
      </IntlClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Radar de vencimientos" })).toBeInTheDocument();
    expect(screen.getByText("Ayuda de planeación. La fecha no es un término legal y LiTT no calcula términos procesales.")).toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Vigencia del arrendamiento" });
    expect(card).toHaveTextContent("Último día para avisar");
    expect(card).toHaveTextContent("Calculado: 31 dic 2026 menos 30 días naturales");
    expect(card).toHaveTextContent("En 15 días");
    expect(screen.getByRole("heading", { name: "Próximos 30 días" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como visto" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bhoras?\b|\bminutos?\b|estimaci/i);
  });
});

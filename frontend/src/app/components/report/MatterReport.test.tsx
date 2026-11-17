import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RetainerReport, RetainerReportSentList } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { MatterReport } from "./MatterReport";
import { isReportDays } from "./reportOptions";

const mocks = vi.hoisted(() => ({
  getRetainerReport: vi.fn(),
  getReportSentHistory: vi.fn(),
  markReportSent: vi.fn(),
  downloadRetainerReport: vi.fn(),
  downloadBlob: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getRetainerReport: mocks.getRetainerReport,
  getReportSentHistory: mocks.getReportSentHistory,
  markReportSent: mocks.markReportSent,
  downloadRetainerReport: mocks.downloadRetainerReport,
}));
vi.mock("@/app/lib/downloadDocument", () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
}));

const DISCLAIMER = "Planning aid. The date is not a legal deadline and LiTT does not calculate procedural deadlines.";
const SCOPE = "It only includes the facts the firm confirmed in the documents it reviewed; some deadlines may not appear.";

const report = (over: Partial<RetainerReport> = {}): RetainerReport => ({
  locale: "en-US",
  matter_name: "Iguala",
  period: { days: 90, start: "2026-08-20", end: "2026-11-17", time_zone: "America/Mexico_City" },
  horizon: { start: "2026-11-17", end: "2027-02-15" },
  requests: {
    total: 3,
    by_type: [{ type_id: "t1", seed_key: "contracts_clients", name: null, count: 2 }, { type_id: "t2", seed_key: null, name: "Poderes", count: 1 }],
    by_complexity: { routine: 2, standard: 0, complex: 1 },
    by_level: { apprentice: 0, junior: 0, senior: 1, partner: 0, unassigned: 2 },
    by_status: { received: 0, in_review: 1, with_client: 0, with_counterparty: 0, closed: 2, cancelled: 0 },
    closed: [
      { id: "r1", title: "Contrato Patito", type_id: "t1", seed_key: "contracts_clients", type_name: null, complexity: "complex", level: "senior", status: "closed", received_on: "2026-10-01", closed_on: "2026-10-11", calendar_days: 10, rounds: 2 },
    ],
    open: [
      { id: "r2", title: "Poder para Ana", type_id: "t2", seed_key: null, type_name: "Poderes", complexity: "routine", level: null, status: "in_review", received_on: "2026-11-10", closed_on: null, calendar_days: 7, rounds: 0 },
    ],
    closed_rounds_total: 2,
    closed_average_calendar_days: 10,
  },
  profile: {
    confirmed_total: 4,
    by_kind: { contract: 1, date: 3, power_of_attorney: 0, obligation: 0, other: 0 },
    confirmed_in_period: [{ id: "f1", kind: "date", label: "Vigencia del arrendamiento", confirmed_on: "2026-10-05" }],
  },
  radar: { upcoming: [{ key: "f1:notice", type: "notice", label: "Vigencia del arrendamiento", due_on: "2026-12-01", days_left: 14, state: "open" }] },
  disclaimer: DISCLAIMER,
  scope_note: SCOPE,
  ...over,
});
const emptyReport = () =>
  report({
    requests: {
      total: 0, by_type: [], by_complexity: { routine: 0, standard: 0, complex: 0 },
      by_level: { apprentice: 0, junior: 0, senior: 0, partner: 0, unassigned: 0 },
      by_status: { received: 0, in_review: 0, with_client: 0, with_counterparty: 0, closed: 0, cancelled: 0 },
      closed: [], open: [], closed_rounds_total: 0, closed_average_calendar_days: null,
    },
    profile: { confirmed_total: 0, by_kind: { contract: 0, date: 0, power_of_attorney: 0, obligation: 0, other: 0 }, confirmed_in_period: [] },
    radar: { upcoming: [] },
  });
const history = (over: Partial<RetainerReportSentList> = {}): RetainerReportSentList => ({
  retainer: true,
  can_write: true,
  sent: [
    { id: "s1", period_start: "2026-08-20", period_end: "2026-11-17", period_days: 90, note: "Por correo a Patito", sent_by: "u1", sent_by_name: "Elena Editora", created_at: "2026-11-17T18:00:00Z" },
    { id: "s2", period_start: "2026-07-20", period_end: "2026-10-17", period_days: 90, note: null, sent_by: null, sent_by_name: null, created_at: "2026-10-17T18:00:00Z" },
  ],
  ...over,
});

const renderPage = () => render(<MatterReport projectId="project-1" matterId="matter-1" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getReportSentHistory.mockResolvedValue(history());
  mocks.getRetainerReport.mockResolvedValue(report());
  mocks.downloadRetainerReport.mockResolvedValue({ blob: new Blob(["x"]), filename: "retainer-report-2026-11-17.docx" });
  mocks.markReportSent.mockResolvedValue(history().sent[0]);
});

describe("MatterReport", () => {
  it("shows a loading state, then the preview with the planning-aid text and the scope note", async () => {
    let resolve!: (value: RetainerReportSentList) => void;
    mocks.getReportSentHistory.mockReturnValue(new Promise((done) => (resolve = done)));
    renderPage();
    expect(screen.getByLabelText("Loading the report")).toHaveAttribute("aria-busy", "true");
    resolve(history());
    await screen.findByRole("heading", { name: "Requests handled" });
    expect(screen.getByRole("heading", { name: "Retainer report", level: 1 })).toBeInTheDocument();
    // The planning-aid text appears in the header and in the preview, the scope note right after it in the preview.
    expect(screen.getAllByText(DISCLAIMER).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(SCOPE)).toBeInTheDocument();
    expect(screen.getByText("From Aug 20, 2026 to Nov 17, 2026 (90 calendar days)")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Matter sections" });
    expect(within(nav).getByRole("link", { name: "Report" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Report" })).toHaveAttribute("href", "/projects/project-1/matters/matter-1/report");
    expect(mocks.getRetainerReport).toHaveBeenCalledWith("project-1", "matter-1", 90, "en-US");
  });

  it("states the numbers by type, complexity, level and state, with rounds and calendar days, and names no hours", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Requests handled" });
    expect(screen.getByText("3 requests in the period (received, closed or still open at its end).")).toBeInTheDocument();
    const byType = screen.getByRole("table", { name: "By type" });
    expect(within(byType).getByText("Contracts with clients")).toBeInTheDocument();
    expect(within(byType).getByText("Poderes")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "By complexity" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "By level of who handled them" })).getByText("Unassigned")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "By state" })).getByText("In review")).toBeInTheDocument();
    const closed = screen.getAllByRole("table", { name: "Requests closed in the period" })[0];
    expect(within(closed).getByText("Contrato Patito")).toBeInTheDocument();
    expect(within(closed).getByRole("columnheader", { name: "Calendar days" })).toBeInTheDocument();
    expect(within(closed).getByRole("columnheader", { name: "Rounds" })).toBeInTheDocument();
    expect(screen.getByText(/Closed: 1\. Negotiation rounds: 2\. Average calendar days to close: 10\./)).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Open requests" })).getByText("Poder para Ana")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Facts confirmed in the period" })).toHaveTextContent("Vigencia del arrendamiento");
    expect(screen.getByRole("table", { name: "Upcoming deadlines" })).toHaveTextContent("Dec 1, 2026");
    expect(screen.getByRole("table", { name: "Upcoming deadlines" })).toHaveTextContent("In 14 days");
    expect(document.body.textContent).not.toMatch(/\bhours?\b|\bhrs?\b/i);
  });

  it("says plainly when there is nothing to report", async () => {
    mocks.getRetainerReport.mockResolvedValue(emptyReport());
    renderPage();
    await screen.findByText("There were no requests in this period.");
    expect(screen.getByText("No request was closed in this period.")).toBeInTheDocument();
    expect(screen.getByText("There are no open requests.")).toBeInTheDocument();
    expect(screen.getByText("No new facts were confirmed in this period.")).toBeInTheDocument();
    expect(screen.getByText("There are no confirmed deadlines in this period.")).toBeInTheDocument();
  });

  it("loads the report again when the period changes, and lists only 30, 60 and 90", async () => {
    const user = userEvent.setup();
    renderPage();
    const select = await screen.findByLabelText("Report period");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Last 30 days", "Last 60 days", "Last 90 days"]);
    await user.selectOptions(select, "30");
    await waitFor(() => expect(mocks.getRetainerReport).toHaveBeenLastCalledWith("project-1", "matter-1", 30, "en-US"));
    expect(isReportDays(45)).toBe(false);
    expect(isReportDays("30")).toBe(false);
    expect(isReportDays(60)).toBe(true);
  });

  it("downloads the Word file for the chosen period", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText("Report period"), "60");
    await screen.findByRole("heading", { name: "Requests handled" });
    await user.click(screen.getByRole("button", { name: "Download Word" }));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "retainer-report-2026-11-17.docx"));
    expect(mocks.downloadRetainerReport).toHaveBeenCalledWith("project-1", "matter-1", 60, "en-US");
  });

  it("falls back to a file name when the server names none, and reports a failed download", async () => {
    const user = userEvent.setup();
    mocks.downloadRetainerReport.mockResolvedValueOnce({ blob: new Blob(["x"]), filename: null });
    renderPage();
    await screen.findByRole("heading", { name: "Requests handled" });
    await user.click(screen.getByRole("button", { name: "Download Word" }));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "report-90d.docx"));
    mocks.downloadRetainerReport.mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Download Word" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The report could not be downloaded." }));
    expect(screen.getByRole("button", { name: "Download Word" })).toBeEnabled();
  });

  it("records the delivery, with a note, and reads the history again; nothing is sent by LiTT", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Requests handled" });
    expect(screen.getByText("LiTT sends nothing. Download the document, send it by your own means, then mark it as sent.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.type(screen.getByLabelText("Note (optional)"), "  A Patito, por correo  ");
    mocks.getReportSentHistory.mockResolvedValue(history({ sent: [history().sent[0], history().sent[0], history().sent[1]] }));
    await user.click(screen.getByRole("button", { name: "Record as sent" }));
    await waitFor(() => expect(mocks.markReportSent).toHaveBeenCalledWith("project-1", "matter-1", 90, { note: "A Patito, por correo" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Recorded as sent.");
    expect(screen.queryByLabelText("Note (optional)")).not.toBeInTheDocument();
    expect(mocks.getReportSentHistory).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole("region", { name: "Reports sent" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("records without a note, and cancelling writes nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Requests handled" });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.type(screen.getByLabelText("Note (optional)"), "borrar");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.markReportSent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Record as sent" }));
    await waitFor(() => expect(mocks.markReportSent).toHaveBeenCalledWith("project-1", "matter-1", 90, {}));
  });

  it("reports a failed record and keeps the form", async () => {
    const user = userEvent.setup();
    mocks.markReportSent.mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByRole("heading", { name: "Requests handled" });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.click(screen.getByRole("button", { name: "Record as sent" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The delivery could not be recorded." }));
    expect(screen.getByLabelText("Note (optional)")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports a failed history reload after recording", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Requests handled" });
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    mocks.getReportSentHistory.mockRejectedValue(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Record as sent" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The sent history could not be loaded." }));
  });

  it("lists who marked a report as sent, when and for which period, newest first", async () => {
    renderPage();
    const list = await screen.findByRole("region", { name: "Reports sent" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Elena Editora marked it as sent on Nov 17, 2026");
    expect(items[0]).toHaveTextContent("Period from Aug 20, 2026 to Nov 17, 2026");
    expect(items[0]).toHaveTextContent("Note: Por correo a Patito");
    expect(items[1]).toHaveTextContent("A person who is no longer here marked it as sent");
    expect(items[1]).not.toHaveTextContent("Note:");
  });

  it("lets a member who cannot write read the history and offers no report", async () => {
    mocks.getReportSentHistory.mockResolvedValue(history({ can_write: false }));
    renderPage();
    await screen.findByText("Only matter owners and editors generate the report. Here you can see when it was marked as sent.");
    expect(mocks.getRetainerReport).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Download Word" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Reports sent" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says an empty history is empty", async () => {
    mocks.getReportSentHistory.mockResolvedValue(history({ sent: [] }));
    renderPage();
    await screen.findByText("Nobody has marked a report as sent yet.");
  });

  it("explains that a matter that is not a retainer has no report", async () => {
    mocks.getReportSentHistory.mockResolvedValue({ retainer: false, can_write: false, sent: [] });
    renderPage();
    await screen.findByText("This matter is not a retainer");
    expect(mocks.getRetainerReport).not.toHaveBeenCalled();
  });

  it("offers a retry when the history cannot be loaded, and a retry when the report cannot", async () => {
    const user = userEvent.setup();
    mocks.getReportSentHistory.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("The report could not be loaded.");
    expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The report could not be loaded." });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Requests handled" });
    mocks.getRetainerReport.mockRejectedValueOnce(new Error("boom"));
    await user.selectOptions(screen.getByLabelText("Report period"), "30");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("ignores an answer that arrives after the page changed matter", async () => {
    let resolve!: (value: RetainerReportSentList) => void;
    mocks.getReportSentHistory.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const view = renderPage();
    view.unmount();
    resolve(history());
    expect(mocks.getRetainerReport).not.toHaveBeenCalled();
  });
});

describe("the report in Spanish", () => {
  it("uses the same fixed texts as the document", async () => {
    mocks.getRetainerReport.mockResolvedValue(report({ locale: "es-MX" }));
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <MatterReport projectId="project-1" matterId="matter-1" />
      </IntlClientProvider>,
    );
    await screen.findByRole("heading", { name: "Solicitudes atendidas" });
    expect(screen.getAllByText(esMX.retainerReport.disclaimer).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Solo incluye los datos que el despacho confirmó en los documentos revisados; puede haber vencimientos que no aparezcan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar Word" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como enviado" })).toBeInTheDocument();
    expect(mocks.getRetainerReport).toHaveBeenCalledWith("project-1", "matter-1", 90, "es-MX");
  });

  it("keeps the two languages' scope notes in step with the server's", () => {
    expect(enUS.retainerReport.scopeNote).toBe(SCOPE);
    expect(enUS.retainerReport.disclaimer).toBe(DISCLAIMER);
  });
});

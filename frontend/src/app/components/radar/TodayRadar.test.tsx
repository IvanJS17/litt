import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RadarToday, RadarTodayItem } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { TodayRadar } from "./TodayRadar";

const mocks = vi.hoisted(() => ({ getRadarToday: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getRadarToday: mocks.getRadarToday,
}));

const item = (over: Partial<RadarTodayItem> = {}): RadarTodayItem => ({
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
  source: { document_id: "d", version_id: "v", version_number: 1, filename: "c.docx", start_char: 0, end_char: 1, quote: "q", text_sha256: "a".repeat(64) },
  project_id: "project-1",
  matter_id: "matter-1",
  matter_name: "Patito · Iguala 2026",
  ...over,
});
const today = (over: Partial<RadarToday> = {}): RadarToday => ({
  today: "2026-11-16",
  time_zone: "America/Mexico_City",
  items: [item()],
  truncated: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRadarToday.mockResolvedValue(today());
});

describe("TodayRadar", () => {
  it("asks for the organization's items, with a loading state of the list's shape", async () => {
    let resolve!: (value: RadarToday) => void;
    mocks.getRadarToday.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<TodayRadar orgId="org-1" />);
    expect(screen.getByLabelText("Loading today's deadlines")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    resolve(today());
    await screen.findByRole("link");
    expect(mocks.getRadarToday).toHaveBeenCalledWith("org-1");
    expect(screen.queryByLabelText("Loading today's deadlines")).not.toBeInTheDocument();
  });

  it("lists the items in the order received, each linking to its matter's radar", async () => {
    mocks.getRadarToday.mockResolvedValue(
      today({
        items: [
          item({ key: "a:notice", label: "Vencido", due_on: "2026-11-10", days_left: -6, bucket: "overdue" }),
          item({ key: "b:expiry", type: "expiry", label: "Hoy mismo", due_on: "2026-11-16", days_left: 0, matter_id: "matter-2", project_id: "project-2", matter_name: "Mapache" }),
          item(),
          item({ key: "c:notice", label: "Hábiles", due_on: null, days_left: null, bucket: "review", review_reason: "business_days", matter_name: null, state: "acknowledged" }),
        ],
      }),
    );
    render(<TodayRadar orgId="org-1" />);
    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Nov 10, 2026 · Expired 6 days ago · Last day to give notice: Vencido · Patito · Iguala 2026",
      "Nov 16, 2026 · Today · Expiry: Hoy mismo · Mapache",
      "Dec 1, 2026 · In 15 days · Last day to give notice: Vigencia del arrendamiento · Patito · Iguala 2026",
      "To review · Last day to give notice: Hábiles · Unnamed matter · Seen",
    ]);
    expect(links[0]).toHaveAttribute("href", "/projects/project-1/matters/matter-1/radar");
    expect(links[1]).toHaveAttribute("href", "/projects/project-2/matters/matter-2/radar");
    expect(links[1]).toHaveAccessibleName("Open the radar of Mapache");
  });

  it("says there is nothing, and says when matters were left out", async () => {
    mocks.getRadarToday.mockResolvedValue(today({ items: [] }));
    const first = render(<TodayRadar orgId="org-1" />);
    expect(await screen.findByText("No confirmed deadlines")).toBeInTheDocument();
    expect(screen.queryByText(/Some matters are not shown here/)).not.toBeInTheDocument();
    first.unmount();
    mocks.getRadarToday.mockResolvedValue(today({ truncated: true }));
    render(<TodayRadar orgId="org-1" />);
    expect(await screen.findByText(/Some matters are not shown here/)).toBeInTheDocument();
  });

  it("fails in place and retries", async () => {
    const user = userEvent.setup();
    mocks.getRadarToday.mockRejectedValueOnce(new Error("down"));
    render(<TodayRadar orgId="org-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The deadlines could not be loaded.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link")).toBeInTheDocument();
    expect(mocks.getRadarToday).toHaveBeenCalledTimes(2);
  });

  it("starts over when the workspace changes and ignores a late reply", async () => {
    let first!: (value: RadarToday) => void;
    mocks.getRadarToday.mockReturnValueOnce(new Promise((done) => (first = done)));
    const view = render(<TodayRadar orgId="org-1" />);
    mocks.getRadarToday.mockResolvedValue(today({ items: [item({ label: "De la otra firma" })] }));
    view.rerender(<TodayRadar orgId="org-2" />);
    expect(await screen.findByText(/De la otra firma/)).toBeInTheDocument();
    await act(async () => first(today({ items: [item({ label: "De la primera firma" })] })));
    expect(screen.queryByText(/De la primera firma/)).not.toBeInTheDocument();
    // A late failure is ignored too.
    let late!: (error: Error) => void;
    mocks.getRadarToday.mockReturnValueOnce(new Promise((_done, fail) => (late = fail)));
    view.rerender(<TodayRadar orgId="org-3" />);
    mocks.getRadarToday.mockResolvedValue(today({ items: [] }));
    view.rerender(<TodayRadar orgId="org-4" />);
    await act(async () => late(new Error("late")));
    expect(await screen.findByText("No confirmed deadlines")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads in Spanish: «Hoy» and «Sin vencimientos confirmados»", async () => {
    mocks.getRadarToday.mockResolvedValue(today({ items: [] }));
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <TodayRadar orgId="org-1" />
      </IntlClientProvider>,
    );
    expect(await screen.findByText("Sin vencimientos confirmados")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hoy" })).toBeInTheDocument();
  });
});

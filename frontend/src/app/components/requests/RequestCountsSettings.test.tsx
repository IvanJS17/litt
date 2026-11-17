import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterRequestCounts } from "@mike/contracts";
import { RequestCountsSettings } from "./RequestCountsSettings";

const mocks = vi.hoisted(() => ({
  getRequestCounts: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getRequestCounts: mocks.getRequestCounts,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: () => null,
}));

const breakdown = (total: number, open = 0, closed = 0, cancelled = 0) => ({ total, open, closed, cancelled });

const counts = (over: Partial<MatterRequestCounts> = {}): MatterRequestCounts => ({
  period: "month",
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  totals: {
    received: 5,
    open: 2,
    closed: 2,
    cancelled: 1,
    open_at_end: 3,
    closed_in_period: 2,
    cancelled_in_period: 1,
    rounds: 4,
    median_days: 12.5,
  },
  by_matter: [
    { ordinal: 1, ...breakdown(3, 1, 2), rounds: 4, median_days: 12.5 },
    { ordinal: 2, ...breakdown(2, 1, 0, 1), rounds: 0, median_days: null },
  ],
  by_type: [
    { type_id: "t-1", seed_key: "contracts_clients", name: null, archived: false, ...breakdown(3, 1, 2) },
    { type_id: "t-2", seed_key: null, name: "Poderes", archived: true, ...breakdown(2, 1, 0, 1) },
  ],
  by_complexity: [{ key: "routine", ...breakdown(5, 2, 2, 1) }],
  by_level: [
    { key: "junior", ...breakdown(3, 1, 2) },
    { key: "unassigned", ...breakdown(2, 1, 0, 1) },
  ],
  by_status: [
    { key: "received", total: 1 },
    { key: "closed", total: 2 },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequestCountsSettings", () => {
  it("shows numbers and opaque labels only, and says the read is audited", async () => {
    mocks.getRequestCounts.mockResolvedValue(counts());
    const { container } = render(<RequestCountsSettings orgId="org-1" />);
    expect(await screen.findByText("Retainer 1")).toBeInTheDocument();
    expect(mocks.getRequestCounts).toHaveBeenCalledWith("org-1", "month", undefined);
    expect(screen.getByText("Retainer 2")).toBeInTheDocument();
    expect(screen.getByText(/recorded in the firm's audit log/)).toBeInTheDocument();
    expect(screen.getByText(/never see a request's title or text/)).toBeInTheDocument();
    const summary = screen.getByRole("group", { hidden: false, name: "Period" });
    expect(summary).toBeInTheDocument();
    expect(screen.getByText("Received in the period").nextSibling).toHaveTextContent("5");
    expect(screen.getByText("Median response time").nextSibling).toHaveTextContent("12.5 calendar days");
    expect(screen.getByText("Contracts with clients")).toBeInTheDocument();
    expect(screen.getByText("Poderes (archived)")).toBeInTheDocument();
    expect(screen.getByText("Routine")).toBeInTheDocument();
    expect(screen.getByText("Junior")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Signed or closed")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/hour/i);
    const matters = screen.getByRole("table", { name: "By retainer matter" });
    expect(within(matters).getAllByRole("row")).toHaveLength(3);
    expect(within(matters).getByText("—")).toBeInTheDocument();
  });

  it("says when no request closed in the period", async () => {
    mocks.getRequestCounts.mockResolvedValue(counts({ totals: { ...counts().totals, median_days: null } }));
    render(<RequestCountsSettings orgId="org-1" />);
    expect(await screen.findByText("No requests closed in the period")).toBeInTheDocument();
  });

  it("switches to the quarter and steps through the periods the server answered", async () => {
    const user = userEvent.setup();
    mocks.getRequestCounts.mockResolvedValue(counts());
    render(<RequestCountsSettings orgId="org-1" />);
    await screen.findByText("Retainer 1");
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Previous period" }));
    expect(mocks.getRequestCounts).toHaveBeenLastCalledWith("org-1", "month", "2026-10-31");
    await screen.findByText("Retainer 1");
    await user.click(screen.getByRole("button", { name: "Next period" }));
    expect(mocks.getRequestCounts).toHaveBeenLastCalledWith("org-1", "month", "2026-12-01");
    await screen.findByText("Retainer 1");
    await user.click(screen.getByRole("button", { name: "Quarter" }));
    expect(mocks.getRequestCounts).toHaveBeenLastCalledWith("org-1", "quarter", "2026-12-01");
    expect(screen.getByRole("button", { name: "Quarter" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the empty state of a firm with no retainer matter", async () => {
    mocks.getRequestCounts.mockResolvedValue(counts({ by_matter: [] }));
    render(<RequestCountsSettings orgId="org-1" />);
    expect(await screen.findByText("The firm has no retainer matters yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty state of a period with no request", async () => {
    mocks.getRequestCounts.mockResolvedValue(
      counts({
        totals: { received: 0, open: 0, closed: 0, cancelled: 0, open_at_end: 0, closed_in_period: 0, cancelled_in_period: 0, rounds: 0, median_days: null },
      }),
    );
    render(<RequestCountsSettings orgId="org-1" />);
    expect(await screen.findByText("No requests in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a loading state, then the error with a retry that loads again", async () => {
    const user = userEvent.setup();
    mocks.getRequestCounts.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(counts());
    render(<RequestCountsSettings orgId="org-1" />);
    expect(screen.getByRole("status", { name: "Loading counts" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the request counts.");
    expect(mocks.notifyError).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Retainer 1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an answer that arrives after the section changed period", async () => {
    const user = userEvent.setup();
    let late: (value: MatterRequestCounts) => void = () => undefined;
    mocks.getRequestCounts
      .mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
      .mockResolvedValue(counts({ period: "quarter" }));
    render(<RequestCountsSettings orgId="org-1" />);
    await user.click(screen.getByRole("button", { name: "Quarter" }));
    expect(await screen.findByText("Retainer 1")).toBeInTheDocument();
    late(counts({ by_matter: [] }));
    await Promise.resolve();
    expect(screen.getByText("Retainer 1")).toBeInTheDocument();
  });

  it("ignores a failure that arrives after the section changed period", async () => {
    const user = userEvent.setup();
    let late: (reason: unknown) => void = () => undefined;
    mocks.getRequestCounts
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (late = reject)))
      .mockResolvedValue(counts());
    render(<RequestCountsSettings orgId="org-1" />);
    await user.click(screen.getByRole("button", { name: "Quarter" }));
    await screen.findByText("Retainer 1");
    late(new Error("late"));
    await Promise.resolve();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

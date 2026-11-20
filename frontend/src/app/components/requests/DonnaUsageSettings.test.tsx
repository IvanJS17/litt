import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DonnaUsage } from "@mike/contracts";
import { DonnaUsageSettings } from "./DonnaUsageSettings";

const mocks = vi.hoisted(() => ({ getDonnaUsage: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getDonnaUsage: mocks.getDonnaUsage,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notifyError, errorCode: () => null }));

const usage = (over: Partial<DonnaUsage> = {}): DonnaUsage => ({
  month: "2026-11",
  limit: 1000,
  used: 12,
  remaining: 988,
  engines: { jev: { runs: 12, input_tokens: 24000, output_tokens: 480, cost_usd: 0.001008 }, byok: { runs: 10 } },
  projects: [{ label: "Proyecto 1", runs: 9 }, { label: "Proyecto 2", runs: 3 }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDonnaUsage.mockResolvedValue(usage());
});

describe("DonnaUsageSettings", () => {
  it("shows the month's runs, tokens, cost and an opaque label per project", async () => {
    render(<DonnaUsageSettings orgId="org-1" />);
    expect(await screen.findByText("12 of 1000 runs used; 988 left.")).toBeInTheDocument();
    expect(screen.getByText(/24,000 input tokens, cost \$0\.001/)).toBeInTheDocument();
    expect(screen.getByText("Proyecto 1")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /monthly limit/ })).not.toBeInTheDocument();
    expect(mocks.getDonnaUsage).toHaveBeenCalledWith("org-1");
  });

  it("says when the cap was reached, and when there is nothing yet", async () => {
    mocks.getDonnaUsage.mockResolvedValue(usage({ used: 1000, remaining: 0 }));
    const view = render(<DonnaUsageSettings orgId="org-1" />);
    expect(await screen.findByText(/monthly limit was reached/)).toBeInTheDocument();
    view.unmount();
    mocks.getDonnaUsage.mockResolvedValue(usage({ used: 0, remaining: 1000, projects: [] }));
    render(<DonnaUsageSettings orgId="org-1" />);
    expect(await screen.findByText("Donna has not analysed requests this month.")).toBeInTheDocument();
  });

  it("offers a retry when it cannot be loaded", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.getDonnaUsage.mockRejectedValueOnce(new Error("down"));
    render(<DonnaUsageSettings orgId="org-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("12 of 1000 runs used; 988 left.")).toBeInTheDocument();
  });
});

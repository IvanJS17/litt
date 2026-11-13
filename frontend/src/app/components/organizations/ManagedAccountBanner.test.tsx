import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManagedAccountBanner } from "./ManagedAccountBanner";

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null | undefined,
  dismissManagedNotice: vi.fn(),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
  useOptionalUserProfile: () => (mocks.profile === undefined ? undefined : { profile: mocks.profile }),
}));
vi.mock("@/app/lib/mikeApi", () => ({ dismissManagedNotice: mocks.dismissManagedNotice }));

const managed = {
  personalWorkspaceDisabled: true,
  managedNoticePending: true,
  managedByFirmName: "Despacho Aurora",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = managed;
  mocks.dismissManagedNotice.mockResolvedValue(undefined);
});

describe("ManagedAccountBanner", () => {
  it("tells the person the firm now manages the account, until they close it", async () => {
    render(<ManagedAccountBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Despacho Aurora now manages your account",
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mocks.dismissManagedNotice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the legal wording whole and lets a phone expand a clamped strip", async () => {
    render(<ManagedAccountBanner />);
    const text = screen.getByText(/now manages your account: you can only use/);
    expect(text).toHaveClass("line-clamp-2");
    await userEvent.click(screen.getByRole("button", { name: "See more" }));
    expect(text).not.toHaveClass("line-clamp-2");
    expect(screen.getByRole("button", { name: "See less" })).toHaveAttribute("aria-expanded", "true");
    // The wording is the one the catalog holds, not a shortened copy.
    expect(text).toHaveTextContent("you can download it in Settings.");
  });

  it("uses the paper surface, not the amber of Tailwind", () => {
    render(<ManagedAccountBanner />);
    expect(screen.getByRole("status").className).toContain("bg-app-surface");
    expect(screen.getByRole("status").className).not.toMatch(/amber/);
  });

  it("closes even when the server could not be told", async () => {
    mocks.dismissManagedNotice.mockRejectedValue(new Error("offline"));
    render(<ManagedAccountBanner />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["no profile yet", null],
    ["no provider", undefined],
    ["an account nobody manages", { ...managed, personalWorkspaceDisabled: false }],
    ["a notice already closed", { ...managed, managedNoticePending: false }],
    ["no firm name", { ...managed, managedByFirmName: null }],
  ])("shows nothing for %s", (_name, profile) => {
    mocks.profile = profile;
    const { container } = render(<ManagedAccountBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScanReadingCard } from "./ScanReadingCard";

vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: () => null,
  needsMfaVerification: async () => false,
}));

const base = {
  hasSavedKey: false,
  enabled: false,
  onToggle: vi.fn(),
  onSaveKey: vi.fn().mockResolvedValue(true),
  onRemoveKey: vi.fn().mockResolvedValue(true),
};

describe("ScanReadingCard", () => {
  it("shows the disclaimer beside the switch before anything is turned on, with no checkbox", () => {
    render(<ScanReadingCard {...base} hasSavedKey enabled={false} />);
    expect(screen.getByRole("heading", { name: "Scan reading" })).toBeInTheDocument();
    expect(screen.getByText(/sent in full to LandingAI, in the United States/)).toBeInTheDocument();
    expect(screen.getByText(/Team and Enterprise/)).toBeInTheDocument();
    expect(screen.getByText(/the text already read is kept/)).toBeInTheDocument();
    expect(screen.getByText(/clause 6.12/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const toggle = screen.getByRole("switch", { name: "Turn on scan reading with LandingAI" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("aria-describedby");
  });

  it("links the official LandingAI pages and the legal texts", () => {
    render(<ScanReadingCard {...base} />);
    expect(screen.getByRole("link", { name: "LandingAI" })).toHaveAttribute("href", "https://www.landing.ai/");
    expect(screen.getByRole("link", { name: "How to get an API key" })).toHaveAttribute(
      "href",
      "https://docs.landing.ai/dpt3/agentic-api-key",
    );
    expect(screen.getByRole("link", { name: "Plans and zero data retention" })).toHaveAttribute(
      "href",
      "https://www.landing.ai/pricing-agentic-apis",
    );
    expect(screen.getByRole("link", { name: "Terms and Conditions" })).toHaveAttribute("href", "/terminos");
    expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/privacidad");
  });

  it("offers no switch until a key is saved; saving and removing go through the field", async () => {
    render(<ScanReadingCard {...base} />);
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.change(screen.getByLabelText("LandingAI API key"), { target: { value: "synthetic-key" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(base.onSaveKey).toHaveBeenCalledWith("synthetic-key"));
  });

  it("turns the saved key on and off", () => {
    const onToggle = vi.fn();
    render(<ScanReadingCard {...base} hasSavedKey enabled onToggle={onToggle} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("is read-only for somebody who cannot manage it", () => {
    render(<ScanReadingCard {...base} hasSavedKey enabled canManage />);
    const { unmount } = render(<ScanReadingCard {...base} hasSavedKey enabled canManage={false} />);
    expect(screen.getAllByText("On").length).toBeGreaterThan(0);
    unmount();
  });

  it("shows a placeholder while loading", () => {
    const { container } = render(<ScanReadingCard {...base} loading />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByLabelText("LandingAI API key")).toBeNull();
  });
});

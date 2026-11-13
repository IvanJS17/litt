import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationFirmProfile } from "./OrganizationFirmProfile";

const mocks = vi.hoisted(() => ({
  getOrgFirmProfile: vi.fn(),
  saveOrgFirmProfile: vi.fn(),
  notifyError: vi.fn(),
  isMfaRequiredError: vi.fn(() => false),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getOrgFirmProfile: mocks.getOrgFirmProfile,
  saveOrgFirmProfile: mocks.saveOrgFirmProfile,
  isMfaRequiredError: mocks.isMfaRequiredError,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: ({ open, onVerified }: { open: boolean; onVerified: () => void }) =>
    open ? <button type="button" onClick={onVerified}>Verify MFA</button> : null,
}));

const HELP = /The assistant reads this profile in every chat in the firm's workspace/;
const WARNING = /Describe only the firm\. Don't write client data/;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isMfaRequiredError.mockReturnValue(false);
});

describe("OrganizationFirmProfile", () => {
  it("shows a member the profile read only, with both notes always on the page", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: { hq_state: "JAL", size: "2-5", description: "Despacho familiar" }, can_manage: false });
    render(<OrganizationFirmProfile orgId="org-1" />);
    expect(await screen.findByLabelText("State of the head office")).toHaveValue("JAL");
    expect(screen.getByLabelText("State of the head office")).toBeDisabled();
    expect(screen.getByLabelText("Description of the firm")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Description of the firm")).toHaveValue("Despacho familiar");
    expect(screen.getByText("Only owners and admins can change the profile.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(screen.getByText(HELP)).toBeVisible();
    expect(screen.getByText(WARNING)).toBeVisible();
  });

  it("puts the warning right at the free-text field, not in a tooltip", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: null, can_manage: true });
    render(<OrganizationFirmProfile orgId="org-1" />);
    const field = await screen.findByLabelText("Description of the firm");
    const warning = screen.getByText(WARNING);
    expect(field).toHaveAttribute("aria-describedby", warning.id);
    expect(warning.closest("[role=tooltip]")).toBeNull();
    expect(field).toHaveAttribute("maxlength", "1000");
  });

  it("lets an admin fill some fields and sends only those", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: null, can_manage: true });
    mocks.saveOrgFirmProfile.mockResolvedValue({ profile: { hq_state: "NLE", practice_areas: ["Tax"], industries: ["Minería", "Banca"] }, can_manage: true });
    render(<OrganizationFirmProfile orgId="org-1" />);
    await userEvent.selectOptions(await screen.findByLabelText("State of the head office"), "NLE");
    await userEvent.click(screen.getByRole("button", { name: "Tax" }));
    await userEvent.type(screen.getByLabelText("Industries"), "Minería, Banca,");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(mocks.saveOrgFirmProfile).toHaveBeenCalledWith("org-1", {
      hq_state: "NLE",
      practice_areas: ["Tax"],
      industries: ["Minería", "Banca"],
    });
  });

  it("does not offer the head office again among the other states", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: { hq_state: "JAL" }, can_manage: true });
    render(<OrganizationFirmProfile orgId="org-1" />);
    await screen.findByLabelText("State of the head office");
    const others = screen.getByRole("group", { name: "Other states where the firm is present" });
    expect(others.querySelectorAll("button")).toHaveLength(32);
    expect(screen.getAllByRole("button", { name: "Jalisco" }).some((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("keeps touch targets at 44 px on a phone", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: null, can_manage: true });
    render(<OrganizationFirmProfile orgId="org-1" />);
    expect((await screen.findByLabelText("Size (lawyers)")).className).toContain("h-11");
    expect(screen.getByRole("button", { name: "Tax" }).className).toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("button", { name: "Save profile" }).className).toContain("pointer-coarse:min-h-11");
  });

  it("asks for the second factor and sends the same profile again", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: null, can_manage: true });
    mocks.isMfaRequiredError.mockReturnValueOnce(true);
    mocks.saveOrgFirmProfile.mockRejectedValueOnce(new Error("mfa")).mockResolvedValueOnce({ profile: { size: "1" }, can_manage: true });
    render(<OrganizationFirmProfile orgId="org-1" />);
    await userEvent.selectOptions(await screen.findByLabelText("Size (lawyers)"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await userEvent.click(await screen.findByRole("button", { name: "Verify MFA" }));
    await waitFor(() => expect(mocks.saveOrgFirmProfile).toHaveBeenCalledTimes(2));
    expect(mocks.saveOrgFirmProfile).toHaveBeenLastCalledWith("org-1", { size: "1" });
  });

  it("clears the profile with null", async () => {
    mocks.getOrgFirmProfile.mockResolvedValue({ profile: { size: "1" }, can_manage: true });
    mocks.saveOrgFirmProfile.mockResolvedValue({ profile: null, can_manage: true });
    render(<OrganizationFirmProfile orgId="org-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear profile" }));
    expect(mocks.saveOrgFirmProfile).toHaveBeenCalledWith("org-1", null);
  });
});

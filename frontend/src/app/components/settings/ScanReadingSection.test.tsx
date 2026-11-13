import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MikeApiError } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { ScanReadingSection } from "./ScanReadingSection";

vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: vi.fn(),
}));

const ctx = vi.hoisted(() => ({
  profile: null as null | { apiKeys: { landingai: { configured: boolean; enabled: boolean; source: string | null } } },
  updateApiKey: vi.fn(),
  updateApiKeyEnabled: vi.fn(),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
  useUserProfile: () => ({
    ...ctx,
    profile: ctx.profile && { ...ctx.profile, personalWorkspaceDisabled: workspace.managed },
  }),
}));
vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: ({ open, onVerified }: { open: boolean; onVerified: () => void }) =>
    open ? <button onClick={onVerified}>verify</button> : null,
  needsMfaVerification: async () => false,
}));

const workspace = vi.hoisted(() => ({
  firm: null as null | { name: string },
  allowPersonal: true,
  /** Whether the firm holds a LandingAI key, and whether it is on. */
  firmLandingai: null as null | { enabled: boolean },
  managed: false,
}));
vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
  useWorkspace: () => ({
    activeOrganization: workspace.firm,
    orgApiKeys: workspace.firm
      ? {
          allow_personal_api_keys: workspace.allowPersonal,
          keys: {
            sources: workspace.firmLandingai ? { landingai: "org" } : {},
            enabled: workspace.firmLandingai ? { landingai: workspace.firmLandingai.enabled } : {},
          },
        }
      : null,
  }),
}));

const saved = (enabled: boolean) => ({
  apiKeys: { landingai: { configured: enabled, enabled, source: "user" } },
});

beforeEach(() => {
  ctx.profile = saved(true);
  workspace.firm = null;
  workspace.allowPersonal = true;
  workspace.firmLandingai = null;
  workspace.managed = false;
  ctx.updateApiKey.mockReset().mockResolvedValue(true);
  ctx.updateApiKeyEnabled.mockReset().mockResolvedValue(true);
  vi.mocked(notifyError).mockReset();
});

describe("ScanReadingSection", () => {
  it("says which workspace the key applies to", () => {
    render(<ScanReadingSection />);
    expect(screen.getByText(/These keys are yours and apply to your personal workspace\./)).toBeVisible();
  });

  it("offers no personal key, and says the firm has none set up, in a firm that does not allow members' own keys", () => {
    workspace.firm = { name: "Socium" };
    workspace.allowPersonal = false;
    render(<ScanReadingSection />);
    expect(screen.getByText(/^Socium has not set up scan reading with LandingAI\./)).toBeVisible();
    expect(screen.queryByText(/gives you the models/)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });

  it("gives a managed account no key of its own, and shows whether the firm has LandingAI", () => {
    workspace.firm = { name: "Despacho Demo" };
    workspace.managed = true;
    const view = render(<ScanReadingSection />);
    expect(screen.getByText(/^Despacho Demo has not set up scan reading with LandingAI\./)).toBeVisible();
    expect(screen.queryByText(/gives you the models|does not allow your own keys/)).toBeNull();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    view.unmount();

    workspace.firmLandingai = { enabled: true };
    render(<ScanReadingSection />);
    expect(screen.getByText("Despacho Demo has set up scan reading with LandingAI. You can't add your own key.")).toBeVisible();
    expect(screen.getByText("On")).toBeVisible();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });

  it("shows how to get a LandingAI key only to someone who can add their own", () => {
    const view = render(<ScanReadingSection />);
    expect(screen.getByText(/create an account and an API key/i)).toBeInTheDocument();
    view.unmount();

    workspace.firm = { name: "Socium" };
    workspace.allowPersonal = false;
    const blocked = render(<ScanReadingSection />);
    expect(screen.queryByText(/create an account and an API key/i)).toBeNull();
    blocked.unmount();

    workspace.allowPersonal = true;
    workspace.managed = true;
    render(<ScanReadingSection />);
    expect(screen.queryByText(/create an account and an API key/i)).toBeNull();
  });

  it("reflects the saved key and turns it off without deleting it", async () => {
    render(<ScanReadingSection />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(ctx.updateApiKeyEnabled).toHaveBeenCalledWith("landingai", false));
    expect(ctx.updateApiKey).not.toHaveBeenCalled();
  });

  it("shows a disabled key as off", () => {
    ctx.profile = saved(false);
    render(<ScanReadingSection />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("shows no switch while a different owner\'s or no key is in place", () => {
    ctx.profile = { apiKeys: { landingai: { configured: false, enabled: true, source: null } } };
    render(<ScanReadingSection />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("raises a notice, with a retry, when the toggle fails", async () => {
    ctx.updateApiKeyEnabled.mockResolvedValue(false);
    render(<ScanReadingSection />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    ctx.updateApiKeyEnabled.mockRejectedValue(new Error("boom"));
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(2));
  });

  it("asks for MFA when the server does, then repeats the change", async () => {
    ctx.updateApiKeyEnabled.mockRejectedValueOnce(
      new MikeApiError({ message: "mfa", status: 403, code: "mfa_verification_required" }),
    );
    render(<ScanReadingSection />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(await screen.findByRole("button", { name: "verify" }));
    await waitFor(() => expect(ctx.updateApiKeyEnabled).toHaveBeenCalledTimes(2));
  });

  it("saves and removes the key", async () => {
    ctx.profile = { apiKeys: { landingai: { configured: false, enabled: true, source: null } } };
    render(<ScanReadingSection />);
    fireEvent.change(screen.getByLabelText("LandingAI API key"), { target: { value: " synthetic-key " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(ctx.updateApiKey).toHaveBeenCalledWith("landingai", "synthetic-key"));
  });

  it("waits for the profile", () => {
    ctx.profile = null;
    const { container } = render(<ScanReadingSection />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MikeApiError } from "@/app/lib/mikeApi";
import { OrganizationScanReading } from "./OrganizationScanReading";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  role: "owner" as "owner" | "member",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./OrganizationSettingsShell", () => ({
  organizationSettingsHref: (orgId: string) => `/organizations/${orgId}/settings`,
  useOrganizationSettings: () => ({ orgId: "org-1", org: { id: "org-1", role: mocks.role } }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getOrgSplitClasses: vi.fn(),
  saveOrgSplitClasses: mocks.save,
}));
vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: ({ open, onVerified }: { open: boolean; onVerified: () => void }) =>
    open ? (
      <button type="button" onClick={onVerified}>
        Verify MFA
      </button>
    ) : null,
}));
// The card has its own tests; this stand-in saves through the prop it is given.
vi.mock("@/app/components/settings/SplitClassesCard", () => ({
  SplitClassesCard: ({ save }: { save: (classes: null) => Promise<unknown> }) => (
    <button type="button" onClick={() => void save(null).catch(() => undefined)}>
      Save classes
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "owner";
});

describe("OrganizationScanReading", () => {
  it("asks for a second factor when the server requires one, then saves the classes", async () => {
    mocks.save
      .mockRejectedValueOnce(
        new MikeApiError({
          message: "MFA verification required",
          status: 403,
          code: "mfa_verification_required",
        }),
      )
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<OrganizationScanReading />);

    await user.click(screen.getByRole("button", { name: "Save classes" }));
    await user.click(await screen.findByRole("button", { name: "Verify MFA" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save).toHaveBeenLastCalledWith("org-1", null);
  });

  it("tells a member why there is nothing to change and leads back to general settings", async () => {
    mocks.role = "member";
    const user = userEvent.setup();
    render(<OrganizationScanReading />);

    await user.click(screen.getByRole("button", { name: "Back to General" }));
    expect(mocks.push).toHaveBeenCalledWith("/organizations/org-1/settings");
  });
});

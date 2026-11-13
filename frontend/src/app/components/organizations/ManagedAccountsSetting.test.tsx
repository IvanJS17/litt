import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MikeApiError, type Org } from "@/app/lib/mikeApi";
import { ManagedAccountsSetting } from "./ManagedAccountsSetting";

const mocks = vi.hoisted(() => ({
  setOrgManagedAccounts: vi.fn(),
  refreshOrganizations: vi.fn(async () => {}),
  notifyError: vi.fn(),
  isMfaRequiredError: vi.fn(() => false),
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ refreshOrganizations: mocks.refreshOrganizations }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  setOrgManagedAccounts: mocks.setOrgManagedAccounts,
  isMfaRequiredError: mocks.isMfaRequiredError,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: ({ open, onVerified, onCancel }: { open: boolean; onVerified: () => void; onCancel: () => void }) =>
    open ? (
      <>
        <button type="button" onClick={onVerified}>Verify MFA</button>
        <button type="button" onClick={onCancel}>Cancel MFA</button>
      </>
    ) : null,
}));

const org = (extra: Partial<Org> = {}) =>
  ({ id: "org-1", name: "Despacho Aurora", role: "owner", ...extra }) as Org;
const setOrg = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isMfaRequiredError.mockReturnValue(false);
  mocks.setOrgManagedAccounts.mockResolvedValue({ managed_accounts: true, managed_members: 2 });
});

describe("ManagedAccountsSetting", () => {
  it("explains the setting in the firm's name, including what happens to personal content", () => {
    render(<ManagedAccountsSetting org={org()} setOrg={setOrg} />);
    expect(screen.getByRole("switch", { name: "Firm-managed accounts" })).not.toBeChecked();
    expect(screen.getByText(/Accounts created by invitation from Despacho Aurora won't have a personal workspace/)).toBeInTheDocument();
    expect(screen.getByText(/is not deleted, but its owner can't open it while in the firm/)).toBeInTheDocument();
  });

  it("turns it on and refreshes the organizations", async () => {
    render(<ManagedAccountsSetting org={org()} setOrg={setOrg} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(mocks.setOrgManagedAccounts).toHaveBeenCalledWith("org-1", true);
    await waitFor(() => expect(setOrg).toHaveBeenCalledWith(expect.objectContaining({ managed_accounts: true })));
    expect(mocks.refreshOrganizations).toHaveBeenCalled();
  });

  it("turns it off from on", async () => {
    mocks.setOrgManagedAccounts.mockResolvedValue({ managed_accounts: false, managed_members: 2 });
    render(<ManagedAccountsSetting org={org({ managed_accounts: true })} setOrg={setOrg} />);
    expect(screen.getByRole("switch")).toBeChecked();
    await userEvent.click(screen.getByRole("switch"));
    expect(mocks.setOrgManagedAccounts).toHaveBeenCalledWith("org-1", false);
  });

  it("asks for a second factor and sends the change again after it", async () => {
    mocks.isMfaRequiredError.mockReturnValue(true);
    mocks.setOrgManagedAccounts.mockRejectedValueOnce(new MikeApiError({ message: "mfa", status: 403, code: "mfa_verification_required" }));
    render(<ManagedAccountsSetting org={org()} setOrg={setOrg} />);
    await userEvent.click(screen.getByRole("switch"));
    mocks.isMfaRequiredError.mockReturnValue(false);
    await userEvent.click(await screen.findByRole("button", { name: "Verify MFA" }));
    await waitFor(() => expect(mocks.setOrgManagedAccounts).toHaveBeenCalledTimes(2));
    expect(setOrg).toHaveBeenCalled();
  });

  it("drops the change when the second factor is cancelled", async () => {
    mocks.isMfaRequiredError.mockReturnValue(true);
    mocks.setOrgManagedAccounts.mockRejectedValueOnce(new Error("mfa"));
    render(<ManagedAccountsSetting org={org()} setOrg={setOrg} />);
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel MFA" }));
    expect(screen.queryByRole("button", { name: "Verify MFA" })).toBeNull();
    expect(mocks.setOrgManagedAccounts).toHaveBeenCalledTimes(1);
  });

  it("reports any other failure, with a retry", async () => {
    mocks.setOrgManagedAccounts.mockRejectedValueOnce(new Error("boom"));
    render(<ManagedAccountsSetting org={org()} setOrg={setOrg} />);
    await userEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    const options = mocks.notifyError.mock.calls[0][1] as { onRetry: () => void };
    options.onRetry();
    await waitFor(() => expect(mocks.setOrgManagedAccounts).toHaveBeenCalledTimes(2));
    expect(setOrg).toHaveBeenCalled();
  });
});

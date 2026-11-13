import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MikeApiError } from "@/app/lib/mikeApi";
import { OnboardingInvitations } from "./OnboardingInvitations";

const mocks = vi.hoisted(() => ({ list: vi.fn(), accept: vi.fn(), decline: vi.fn(), changed: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (original) => ({
    ...await original<typeof import("@/app/lib/mikeApi")>(),
    listMyOrgInvitations: mocks.list, acceptOrgInvitation: mocks.accept, declineOrgInvitation: mocks.decline,
}));
vi.mock("@/app/hooks/useOrganizationInvitationCount", () => ({ notifyOrganizationInvitationsChanged: mocks.changed }));

const invitation = { id: "invite", org_id: "org", org_name: "Example LLP", role: "admin", invited_by_email: "dana@example.test" };
const second = { id: "invite-2", org_id: "org-2", org_name: "Other LLP", role: "member", invited_by_email: null };
const busy = vi.fn();
const onAnswered = vi.fn();
const onNone = vi.fn();
const onLoadFailed = vi.fn();
const renderInvitations = () => render(
    <OnboardingInvitations userId="new-user" onBusyChange={busy} onAnswered={onAnswered} onNone={onNone} onLoadFailed={onLoadFailed} />,
);
beforeEach(() => {
    vi.clearAllMocks(); window.localStorage.clear();
    mocks.list.mockResolvedValue([invitation]);
    mocks.accept.mockResolvedValue({ org_id: "org", role: "admin" });
    mocks.decline.mockResolvedValue(undefined);
});

it("names the firm, the offered role and the inviter before anything is accepted", async () => {
    const user = userEvent.setup(); renderInvitations();
    const accept = await screen.findByRole("button", { name: "Accept Example LLP" });
    expect(screen.getByText("Example LLP invited you to join as Admin")).toBeVisible();
    expect(screen.getByText("From dana@example.test")).toBeVisible();
    expect(mocks.accept).not.toHaveBeenCalled();
    await user.click(accept);
    expect(await screen.findByText("Joined")).toBeVisible();
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith("invite");
    // The firm joined is the workspace the app opens in.
    expect(window.localStorage.getItem("mike.activeWorkspace.new-user")).toBe("org");
    expect(mocks.changed).toHaveBeenCalledOnce();
    expect(onAnswered).toHaveBeenCalledExactlyOnceWith(true);
    expect(busy).toHaveBeenLastCalledWith(false);
});

it("lists every invitation and moves on only when all are answered", async () => {
    mocks.list.mockResolvedValue([invitation, second]);
    const user = userEvent.setup(); renderInvitations();
    await user.click(await screen.findByRole("button", { name: "Decline Other LLP" }));
    expect(mocks.decline).toHaveBeenCalledExactlyOnceWith("invite-2");
    expect(await screen.findByText("Declined")).toBeVisible();
    expect(onAnswered).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("mike.activeWorkspace.new-user")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Accept Example LLP" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalledExactlyOnceWith(true));
});

it("reports that nothing was joined when every invitation is declined", async () => {
    const user = userEvent.setup(); renderInvitations();
    await user.click(await screen.findByRole("button", { name: "Decline Example LLP" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalledExactlyOnceWith(false));
    expect(window.localStorage.getItem("mike.activeWorkspace.new-user")).toBeNull();
});

it("says so when nobody invited the person", async () => {
    mocks.list.mockResolvedValue([]); renderInvitations();
    await waitFor(() => expect(onNone).toHaveBeenCalledOnce());
    expect(onAnswered).not.toHaveBeenCalled();
});

it("allows a failed lookup to be retried and never presents it as an empty list", async () => {
    mocks.list.mockRejectedValueOnce(new Error("raw internal error"));
    const user = userEvent.setup(); renderInvitations();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your invitations.");
    expect(onLoadFailed).toHaveBeenCalledOnce();
    expect(onNone).not.toHaveBeenCalled();
    expect(busy).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Accept Example LLP" })).toBeEnabled();
});

it("keeps failed or expired invitations from selecting a workspace and supports refreshing", async () => {
    mocks.accept.mockRejectedValueOnce(new MikeApiError({ status: 410, message: "That invitation has expired." }));
    const user = userEvent.setup(); renderInvitations();
    await user.click(await screen.findByRole("button", { name: "Accept Example LLP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That invitation has expired.");
    expect(window.localStorage.getItem("mike.activeWorkspace.new-user")).toBeNull();
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(onAnswered).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: "Refresh invitations" }));
    await waitFor(() => expect(onNone).toHaveBeenCalledOnce());
});

it("ignores a second answer while one is in flight", async () => {
    let resolve!: (value: unknown) => void;
    mocks.decline.mockReturnValue(new Promise((done) => { resolve = done; }));
    mocks.list.mockResolvedValue([invitation, second]);
    const user = userEvent.setup(); renderInvitations();
    await user.click(await screen.findByRole("button", { name: "Decline Example LLP" }));
    expect(screen.getByRole("button", { name: "Decline Other LLP" })).toBeDisabled();
    await act(async () => resolve(undefined));
    expect(mocks.decline).toHaveBeenCalledOnce();
});

it("does not persist a late acceptance after the user leaves onboarding", async () => {
    let resolve!: (value: unknown) => void;
    mocks.accept.mockReturnValue(new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(); const { unmount } = renderInvitations();
    await user.click(await screen.findByRole("button", { name: "Accept Example LLP" }));
    unmount();
    await act(async () => resolve({ org_id: "org", role: "admin" }));
    expect(window.localStorage.getItem("mike.activeWorkspace.new-user")).toBeNull();
    expect(mocks.changed).not.toHaveBeenCalled();
});

it("does not persist a late decline after the user leaves onboarding", async () => {
    let resolve!: (value: unknown) => void;
    mocks.decline.mockReturnValue(new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(); const { unmount } = renderInvitations();
    await user.click(await screen.findByRole("button", { name: "Decline Example LLP" }));
    unmount();
    await act(async () => resolve(undefined));
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(onAnswered).not.toHaveBeenCalled();
});

it("does not mistake blocked browser storage for a failed invitation acceptance", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
        const user = userEvent.setup(); renderInvitations();
        await user.click(await screen.findByRole("button", { name: "Accept Example LLP" }));
        expect(await screen.findByText("Joined")).toBeVisible();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally { storage.mockRestore(); }
});

it("falls back to a generic name for a firm without one", async () => {
    mocks.list.mockResolvedValue([{ ...invitation, org_name: null }]); renderInvitations();
    expect(await screen.findByText("Organization invited you to join as Admin")).toBeVisible();
});

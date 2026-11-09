import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetaInvitationsSection } from "./BetaInvitationsSection";

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", () => ({
    listPlatformInvitations: mocks.list,
    createPlatformInvitation: mocks.create,
    deletePlatformInvitation: mocks.remove,
}));

const pending = {
    id: "inv-1",
    email: "ana@firm.example",
    status: "pending",
    expires_at: "2999-01-01T00:00:00Z",
    created_at: "2026-11-09T00:00:00Z",
    used_at: null,
};

describe("BetaInvitationsSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue([pending]);
    });

    it.each([
        [true, "We emailed them the invitation"],
        [false, "We couldn't send the email. Tell them to sign in to LiTT with that email"],
    ])("invites by email and reports email_sent=%s", async (emailSent, notice) => {
        mocks.create.mockResolvedValue({ ...pending, email_sent: emailSent });
        const user = userEvent.setup();
        render(<BetaInvitationsSection />);

        expect(await screen.findByText("ana@firm.example")).toBeInTheDocument();
        await user.type(screen.getByLabelText("Invitee's email"), "new@firm.example");
        await user.click(screen.getByRole("button", { name: "Invite" }));

        expect(mocks.create).toHaveBeenCalledWith("new@firm.example");
        expect(await screen.findByText(notice)).toBeInTheDocument();
    });

    it("cancels a pending invitation only after confirming", async () => {
        mocks.remove.mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(<BetaInvitationsSection />);

        await user.click(await screen.findByRole("button", { name: "Cancel invitation" }));
        expect(mocks.remove).not.toHaveBeenCalled();
        await user.click(
            within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel invitation" }),
        );

        await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("inv-1"));
    });
});

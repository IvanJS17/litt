import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountDeletedPage from "./page";
import { ACCOUNT_DELETION_TOKEN_KEY } from "@/app/lib/accountDeletion";

const state = vi.hoisted(() => ({
    replace: vi.fn(),
    signOut: vi.fn(),
    getAccountDeletionReceipt: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: state.replace }),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ signOut: state.signOut }),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getAccountDeletionReceipt: state.getAccountDeletionReceipt,
}));

const completed = {
    status: "completed" as const,
    requested_at: "2026-10-24T15:00:00Z",
    completed_at: "2026-10-24T15:01:00Z",
    backups_expire_on: "2026-11-23",
    deleted: ["Personal documents", "Chats outside matters"],
    retained: [
        { item: "Matter documents", reason: "They belong to the firm" },
    ],
};

describe("AccountDeletedPage", () => {
    beforeEach(() => {
        sessionStorage.clear();
        state.replace.mockReset();
        state.signOut.mockReset();
        state.getAccountDeletionReceipt.mockReset();
    });

    it("says there is nothing to show without a token, and reads nothing", async () => {
        render(<AccountDeletedPage />);

        expect(
            await screen.findByText(/no account deletion to show/i),
        ).toBeInTheDocument();
        expect(state.getAccountDeletionReceipt).not.toHaveBeenCalled();
    });

    it("shows progress until the receipt is ready, then what was deleted, kept and when backups expire", async () => {
        sessionStorage.setItem(ACCOUNT_DELETION_TOKEN_KEY, "token-1");
        state.getAccountDeletionReceipt
            .mockResolvedValueOnce({ status: "running", requested_at: completed.requested_at })
            .mockResolvedValue(completed);
        render(<AccountDeletedPage />);

        expect(await screen.findByRole("status")).toHaveTextContent(
            "Deleting your account",
        );
        expect(
            screen.queryByRole("button", { name: "Finish and sign out" }),
        ).not.toBeInTheDocument();

        expect(
            await screen.findByText("Your account has been deleted"),
        ).toBeInTheDocument();
        expect(state.getAccountDeletionReceipt).toHaveBeenCalledWith("token-1");
        expect(screen.getByText("Personal documents")).toBeInTheDocument();
        expect(
            screen.getByText("Matter documents. They belong to the firm"),
        ).toBeInTheDocument();
        // A date-only value is a UTC date: shown as that day in any timezone.
        expect(screen.getByText(/23/)).toHaveTextContent("2026");
        expect(screen.getByText(/23/).tagName).toBe("STRONG");
        // The receipt is on screen before the local session is cleared.
        expect(state.signOut).not.toHaveBeenCalled();
    });

    it("tells the person when deletion failed", async () => {
        sessionStorage.setItem(ACCOUNT_DELETION_TOKEN_KEY, "token-1");
        state.getAccountDeletionReceipt.mockResolvedValue({
            status: "failed",
            requested_at: completed.requested_at,
        });
        render(<AccountDeletedPage />);

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "could not be fully deleted",
        );
    });

    it("signs out, forgets the token and leaves once the person finishes", async () => {
        sessionStorage.setItem(ACCOUNT_DELETION_TOKEN_KEY, "token-1");
        state.getAccountDeletionReceipt.mockResolvedValue(completed);
        state.signOut.mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(<AccountDeletedPage />);

        await user.click(
            await screen.findByRole("button", { name: "Finish and sign out" }),
        );

        await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/"));
        expect(state.signOut).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(ACCOUNT_DELETION_TOKEN_KEY)).toBeNull();
    });
});

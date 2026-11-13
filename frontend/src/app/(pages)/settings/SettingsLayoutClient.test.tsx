import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformMe, listMyOrgInvitations, type OrgInvitation } from "@/app/lib/mikeApi";
import { invalidatePlatformMe } from "@/app/hooks/usePlatformMe";
import { ToastViewportUI, clearToasts } from "@mike/ui";
import SettingsLayout from "./SettingsLayoutClient";

const push = vi.fn();
let pathname = "/settings/memory";

vi.mock("next/navigation", () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push }),
}));

const auth = vi.hoisted(() => ({ authLoading: false }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: true,
        authLoading: auth.authLoading,
        user: { id: "me" },
    }),
}));

vi.mock("@/app/lib/mikeApi", () => ({
    listMyOrgInvitations: vi.fn(),
    getPlatformMe: vi.fn(),
}));

// What Privacy & Data may do in the active workspace; everything unless a
// test says otherwise.
const dataActions = vi.hoisted(() => ({ canExport: true, canDelete: true }));
vi.mock("@/app/hooks/useMemberDataActions", () => ({
    useMemberDataActions: () => dataActions,
}));

// Where the person's own keys do not apply, the keys tab is the firm's.
const keyScope = vi.hoisted(() => ({ personalBlocked: false, firmName: null as string | null }));
vi.mock("@/app/components/settings/KeyScope", () => ({
    useKeyScope: () => keyScope,
}));

describe("SettingsLayout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidatePlatformMe();
        clearToasts();
        pathname = "/settings/memory";
        auth.authLoading = false;
        vi.mocked(listMyOrgInvitations).mockResolvedValue([]);
        vi.mocked(getPlatformMe).mockResolvedValue({ admin: false, can_create_org: false });
        dataActions.canExport = true;
        dataActions.canDelete = true;
        keyScope.personalBlocked = false;
        keyScope.firmName = null;
    });

    it("while the session loads draws the settings frame in grey lines, not a full-screen spinner", () => {
        auth.authLoading = true;
        const { container } = render(
            <SettingsLayout>
                <div>page</div>
            </SettingsLayout>,
        );
        const skeleton = container.querySelector("[data-slot='settings-shell-skeleton']");
        expect(skeleton).not.toBeNull();
        expect(skeleton?.querySelectorAll(".animate-pulse").length).toBeGreaterThan(10);
        expect(container.querySelector(".animate-spin")).toBeNull();
        expect(screen.queryByText("page")).not.toBeInTheDocument();
    });

    it("names the keys tab after the firm's keys where the person's own do not apply", async () => {
        keyScope.personalBlocked = true;
        keyScope.firmName = "Despacho Demo";
        render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        expect(await screen.findByRole("button", { name: "Firm keys" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Bring Your Own Keys" })).toBeNull();
    });

    it("keeps the personal keys tab otherwise", async () => {
        render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        expect(await screen.findByRole("button", { name: "Bring Your Own Keys" })).toBeInTheDocument();
    });

    it("lists Privacy & Data while it has an export or a delete to offer", async () => {
        dataActions.canDelete = false;
        render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        expect(
            await screen.findByRole("button", { name: "Privacy & Data" }),
        ).toBeInTheDocument();
    });

    it("does not list Privacy & Data when the organization allows members neither", async () => {
        dataActions.canExport = false;
        dataActions.canDelete = false;
        render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        expect(await screen.findByRole("button", { name: "Memory" })).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Privacy & Data" }),
        ).toBeNull();
    });

    it("exposes Memory as a dedicated settings page and marks it current", async () => {
        const user = userEvent.setup();
        render(
            <SettingsLayout>
                <div>Memory content</div>
            </SettingsLayout>,
        );

        const memoryTab = await screen.findByRole("button", { name: "Memory" });
        expect(memoryTab).toHaveAttribute("aria-current", "page");
        expect(screen.getByText("Memory content")).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Features" }));
        expect(push).toHaveBeenCalledWith("/settings/features");
    });

    it("links to My Activity from Settings", async () => {
        const user = userEvent.setup();
        render(
            <SettingsLayout>
                <div>Activity content</div>
            </SettingsLayout>,
        );

        const activityTab = await screen.findByRole("button", { name: "My Activity" });
        await user.click(activityTab);
        expect(push).toHaveBeenCalledWith("/settings/my-activity");
    });

    it("lets My Activity use a full table page outside the settings frame", async () => {
        pathname = "/settings/my-activity";
        render(
            <SettingsLayout>
                <div>Activity table</div>
            </SettingsLayout>,
        );

        expect(await screen.findByText("Activity table")).toBeVisible();
        expect(
            screen.queryByRole("navigation", { name: "Settings" }),
        ).toBeNull();
        expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    });

    it("shows the pending invitation count beside Organizations and opens the page", async () => {
        vi.mocked(listMyOrgInvitations).mockResolvedValue([
            { id: "invite-1" },
            { id: "invite-2" },
        ] as OrgInvitation[]);
        const user = userEvent.setup();
        render(
            <SettingsLayout>
                <div>Settings content</div>
            </SettingsLayout>,
        );

        const organizations = await screen.findByRole("button", {
            name: /Organizations/,
        });
        await waitFor(() =>
            expect(organizations).toHaveAccessibleName(
                "Organizations 2 pending invitations",
            ),
        );
        await user.click(organizations);
        expect(push).toHaveBeenCalledWith("/settings/organizations");
    });

    it("lists Beta invitations only for a platform administrator", async () => {
        const { unmount } = render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        await waitFor(() => expect(getPlatformMe).toHaveBeenCalled());
        expect(
            screen.queryByRole("button", { name: "Beta invitations" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Beta statistics" }),
        ).not.toBeInTheDocument();
        unmount();
        invalidatePlatformMe();

        vi.mocked(getPlatformMe).mockResolvedValue({ admin: true, can_create_org: true });
        render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        expect(
            await screen.findByRole("button", { name: "Beta invitations" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Beta statistics" })).toBeInTheDocument();
    });

    it("keeps the frame in grey lines until the beta answer arrives, then shows every tab at once", async () => {
        let answer!: (me: { admin: boolean; can_create_org: boolean }) => void;
        vi.mocked(getPlatformMe).mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            }),
        );
        const { container } = render(
            <SettingsLayout>
                <div>page</div>
            </SettingsLayout>,
        );
        expect(container.querySelector("[data-slot='settings-shell-skeleton']")).not.toBeNull();
        expect(screen.queryByRole("button", { name: "Memory" })).toBeNull();

        answer({ admin: true, can_create_org: true });
        // The usual tabs and the beta ones arrive in the same render.
        const memory = await screen.findByRole("button", { name: "Memory" });
        expect(memory).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Beta invitations" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Beta statistics" })).toBeInTheDocument();
        expect(container.querySelector("[data-slot='settings-shell-skeleton']")).toBeNull();
    });

    it("asks once for the beta answer, however many times the frame is shown", async () => {
        const first = render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        await screen.findByRole("button", { name: "Memory" });
        first.unmount();
        render(
            <SettingsLayout>
                <div />
            </SettingsLayout>,
        );
        await screen.findByRole("button", { name: "Memory" });
        expect(getPlatformMe).toHaveBeenCalledTimes(1);
    });

    it("retries a failed beta read and then still shows the tabs", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            vi.mocked(getPlatformMe)
                .mockRejectedValueOnce(new Error("blip"))
                .mockResolvedValueOnce({ admin: true, can_create_org: true });
            render(
                <SettingsLayout>
                    <div />
                </SettingsLayout>,
            );
            await vi.advanceTimersByTimeAsync(1_000);
            expect(
                await screen.findByRole("button", { name: "Beta invitations" }),
            ).toBeInTheDocument();
            expect(getPlatformMe).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not hide the settings for good when the beta read keeps failing", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            vi.mocked(getPlatformMe).mockRejectedValue(new Error("down"));
            render(
                <>
                    <SettingsLayout>
                        <div />
                    </SettingsLayout>
                    <ToastViewportUI />
                </>,
            );
            await vi.advanceTimersByTimeAsync(5_000);
            expect(await screen.findByRole("button", { name: "Memory" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Beta invitations" })).toBeNull();
            // It says so, with a way to try again.
            expect(await screen.findByText(/load all your settings tabs/i)).toBeInTheDocument();
            expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
            // Three reads (first try and two retries), then it reports.
            expect(getPlatformMe).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

});

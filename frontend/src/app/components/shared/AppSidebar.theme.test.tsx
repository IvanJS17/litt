import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";

const { updateTheme, profile } = vi.hoisted(() => ({
    updateTheme: vi.fn(),
    profile: {
        displayName: "Alice",
        tier: "Free",
        theme: "system" as "light" | "dark" | "system",
    },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => "/assistant",
}));
vi.mock("next/image", () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock("@/app/lib/mikeApi", () => ({ listProjectsPage: vi.fn().mockResolvedValue([]) }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "sidebar-user", email: "alice@example.com" },
        signOut: vi.fn(),
    }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile, updateTheme }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({
        chats: [],
        loadingMoreChats: false,
        loadMoreChats: vi.fn(),
        setCurrentChatId: vi.fn(),
    }),
}));

async function openAccountMenu() {
    const user = userEvent.setup();
    render(<AppSidebar isOpen onToggle={vi.fn()} />);
    await user.click(screen.getByText("Alice").closest("button")!);
    return user;
}

describe("the theme in the account menu", () => {
    beforeEach(() => {
        updateTheme.mockReset();
        updateTheme.mockResolvedValue(undefined);
        profile.theme = "system";
        vi.stubGlobal(
            "matchMedia",
            vi.fn((query: string) => ({
                media: query,
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        );
    });

    it("sits after the workspace and before Settings, as three radios named Light, Dark and Auto", async () => {
        await openAccountMenu();
        const group = screen.getByRole("radiogroup", { name: "Theme" });
        expect(group).toBeVisible();
        expect(screen.getByRole("radio", { name: "Light" })).toBeVisible();
        expect(screen.getByRole("radio", { name: "Dark" })).toBeVisible();
        expect(screen.getByRole("radio", { name: "Automatic (follows your device)" })).toHaveTextContent("Auto");

        const settings = screen.getByRole("menuitem", { name: "Settings" });
        expect(
            group.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("says what Automático gives right now, and only then", async () => {
        const user = await openAccountMenu();
        expect(screen.getByText("now: dark")).toBeVisible();

        await user.click(screen.getByRole("radio", { name: "Light" }));
        await waitFor(() => expect(updateTheme).toHaveBeenCalledWith("light"));
    });

    it("does not say it for a theme that is not Automático", async () => {
        profile.theme = "dark";
        await openAccountMenu();
        expect(screen.queryByText(/^now:/)).not.toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    });

    it("saves the choice and leaves the menu open", async () => {
        const user = await openAccountMenu();
        await user.click(screen.getByRole("radio", { name: "Dark" }));

        await waitFor(() => expect(updateTheme).toHaveBeenCalledExactlyOnceWith("dark"));
        expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
        expect(screen.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    });

    it("is reached by keyboard: Left and Right choose, Up and Down walk on to the next item", async () => {
        profile.theme = "light";
        const user = await openAccountMenu();
        screen.getByRole("radio", { name: "Light" }).focus();

        await user.keyboard("{ArrowRight}");
        await waitFor(() => expect(updateTheme).toHaveBeenLastCalledWith("dark"));
        expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeVisible();

        await user.keyboard("{ArrowDown}");
        expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    });
});

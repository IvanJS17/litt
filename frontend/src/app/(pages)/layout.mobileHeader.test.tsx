import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MikeLayout from "./layout";

const navigation = vi.hoisted(() => ({
    pathname: "/assistant/chat/chat-1",
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    usePathname: () => navigation.pathname,
    useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: true,
        authLoading: false,
    }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    ChatHistoryProvider: ({ children }: { children: React.ReactNode }) =>
        children,
}));
// Records what the layout actually renders the sidebar with, so the
// persistence tests can compare it against the stored preference.
const sidebarState = vi.hoisted(() => ({
    isOpen: false,
    rendered: [] as boolean[],
}));
vi.mock("@/app/components/shared/AppSidebar", () => ({
    AppSidebar: ({ isOpen }: { isOpen: boolean }) => {
        sidebarState.isOpen = isOpen;
        sidebarState.rendered.push(isOpen);
        return null;
    },
}));
vi.mock("@/app/components/shared/FullScreenLoader", () => ({
    FullScreenLoader: () => null,
}));

beforeEach(() => {
    navigation.pathname = "/assistant/chat/chat-1";
    navigation.push.mockReset();
    localStorage.clear();
    sidebarState.isOpen = false;
    sidebarState.rendered = [];
});

describe("mobile page header", () => {
    it("floats transparently over chat pages", () => {
        render(
            <MikeLayout>
                <div>Chat</div>
            </MikeLayout>,
        );

        const header = document.querySelector('[data-slot="mobile-header"]');
        expect(header).toHaveClass(
            "fixed",
            "inset-x-0",
            "top-0",
            "bg-transparent",
        );
    });

    it("floats transparently over project chat workspaces", () => {
        navigation.pathname = "/projects/project-1/assistant/chat/chat-1";
        render(
            <MikeLayout>
                <div>Project chat</div>
            </MikeLayout>,
        );

        const header = document.querySelector('[data-slot="mobile-header"]');
        expect(header).toHaveClass(
            "fixed",
            "inset-x-0",
            "top-0",
            "bg-transparent",
        );
    });

    it("uses the header-button styling for the sidebar toggle", () => {
        render(
            <MikeLayout>
                <div>Page</div>
            </MikeLayout>,
        );

        const toggle = screen.getByRole("button", { name: "Open sidebar" });
        expect(toggle).toHaveClass("h-7", "w-7", "rounded-full");
        expect(toggle.parentElement).toHaveClass(
            "liquid-glass-subtle",
            "rounded-full",
        );
    });

    it("keeps the mobile header in normal flow on non-chat pages", () => {
        navigation.pathname = "/projects";
        render(
            <MikeLayout>
                <div>Projects</div>
            </MikeLayout>,
        );

        const header = document.querySelector('[data-slot="mobile-header"]');
        expect(header).toHaveClass("relative", "shrink-0");
        expect(header).not.toHaveClass("fixed");
    });
});

/**
 * The desktop sidebar has two pieces of state: `isSidebarOpen` (what is
 * rendered) and `isSidebarOpenDesktop` (what the toggle flips). Only the
 * former has a mount-time value on desktop — the initializer always starts
 * open — so the stored key has to mirror it. Storing the preference instead
 * makes the next mount restore a value that disagrees with the sidebar on
 * screen, and the first toggle click only re-syncs the two.
 * Live A/B: .claude/pr295-evidence/fr-03-sidebar-toggle-pr.log.
 */
describe("desktop sidebar persistence", () => {
    // The workspace collapses the sidebar; opening it first and collapsing it
    // after the page mounts slid the whole workspace sideways (CLS 0.11-0.17).
    // "New chat" (no chat id) renders the same workspace page.
    it.each([
        "/projects/project-1/assistant/chat/chat-1",
        "/projects/project-1/assistant/chat",
        "/projects/project-1/assistant/chat/",
    ])("renders the sidebar collapsed from the start on %s", (pathname) => {
        navigation.pathname = pathname;

        render(
            <MikeLayout>
                <div>Workspace</div>
            </MikeLayout>,
        );

        expect(sidebarState.rendered.length).toBeGreaterThan(0);
        expect(sidebarState.rendered.every((open) => open === false)).toBe(
            true,
        );
    });

    it.each(["/projects/project-1", "/projects/project-1/assistant/chats"])(
        "keeps the sidebar open on %s",
        (pathname) => {
            navigation.pathname = pathname;

            render(
                <MikeLayout>
                    <div>Page</div>
                </MikeLayout>,
            );

            expect(sidebarState.isOpen).toBe(true);
        },
    );

    it("stores the state the sidebar is rendered with", () => {
        localStorage.setItem("sidebarOpen", "false");

        render(
            <MikeLayout>
                <div>Page</div>
            </MikeLayout>,
        );

        expect(sidebarState.isOpen).toBe(true);
        expect(localStorage.getItem("sidebarOpen")).toBe("true");
    });

    it("collapses on the first toggle click after a remount", async () => {
        localStorage.setItem("sidebarOpen", "false");
        const first = render(
            <MikeLayout>
                <div>Page</div>
            </MikeLayout>,
        );
        first.unmount();

        // A reload re-reads the key written by the previous session.
        render(
            <MikeLayout>
                <div>Page</div>
            </MikeLayout>,
        );
        expect(sidebarState.isOpen).toBe(true);

        await userEvent.click(
            screen.getByRole("button", { name: "Open sidebar" }),
        );

        expect(sidebarState.isOpen).toBe(false);
        expect(localStorage.getItem("sidebarOpen")).toBe("false");
    });
});

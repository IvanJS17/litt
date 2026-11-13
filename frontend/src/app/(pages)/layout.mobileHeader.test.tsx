import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    it("names the open workspace beside the sidebar button, even with the sidebar closed", () => {
        render(
            <MikeLayout>
                <div>Chat</div>
            </MikeLayout>,
        );

        const header = document.querySelector('[data-slot="mobile-header"]');
        expect(header).toHaveTextContent("My personal workspace");
    });

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

    it("keeps the header clear of the notch and the shell clear of the home indicator", () => {
        render(
            <MikeLayout>
                <div>Chat</div>
            </MikeLayout>,
        );

        const header = document.querySelector('[data-slot="mobile-header"]');
        expect(header?.className).toContain("env(safe-area-inset-top)");
        expect(header?.className).toContain("env(safe-area-inset-left)");
        expect(header?.className).toContain("env(safe-area-inset-right)");
        const shell = header?.closest(".h-dvh");
        expect(shell?.className).toContain("pb-[env(safe-area-inset-bottom)]");
    });

    // Floating, the sidebar button covered the Explorer title on a phone.
    it.each([
        "/projects/project-1/assistant/chat/chat-1",
        "/projects/project-1/assistant/chat",
    ])("keeps the header in flow above the project workspace on %s", (pathname) => {
        navigation.pathname = pathname;
        render(
            <MikeLayout>
                <div>Project chat</div>
            </MikeLayout>,
        );

        const header = document.querySelector('[data-slot="mobile-header"]');
        expect(header).toHaveClass("relative", "shrink-0");
        expect(header).not.toHaveClass("fixed");
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

    // Client navigation keeps the layout mounted, so its initializer does not
    // run again: the sidebar must collapse in the render that shows the
    // workspace, never painting it open first.
    it.each([
        "/projects/project-1/assistant/chat/chat-1",
        "/projects/project-1/assistant/chat",
    ])("collapses without painting it open when navigating to %s", (pathname) => {
        navigation.pathname = "/projects/project-1";
        const view = render(
            <MikeLayout>
                <div>Project</div>
            </MikeLayout>,
        );
        expect(sidebarState.isOpen).toBe(true);
        sidebarState.rendered = [];

        navigation.pathname = pathname;
        view.rerender(
            <MikeLayout>
                <div>Workspace</div>
            </MikeLayout>,
        );

        expect(sidebarState.rendered.length).toBeGreaterThan(0);
        expect(sidebarState.rendered.every((open) => open === false)).toBe(
            true,
        );
    });

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

describe("sidebar overlay on a phone", () => {
    const setWidth = (w: number) =>
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            writable: true,
            value: w,
        });
    const original = window.innerWidth;
    afterEach(() => setWidth(original));

    it("closes when navigating on a screen under 768 px", async () => {
        setWidth(390);
        const view = render(
            <MikeLayout>
                <div>Page</div>
            </MikeLayout>,
        );
        await userEvent.click(
            screen.getByRole("button", { name: "Open sidebar" }),
        );
        expect(sidebarState.isOpen).toBe(true);

        navigation.pathname = "/projects";
        view.rerender(
            <MikeLayout>
                <div>Projects</div>
            </MikeLayout>,
        );

        expect(sidebarState.isOpen).toBe(false);
    });

    it("stays open when navigating on desktop", () => {
        setWidth(1280);
        const view = render(
            <MikeLayout>
                <div>Page</div>
            </MikeLayout>,
        );
        expect(sidebarState.isOpen).toBe(true);

        navigation.pathname = "/projects";
        view.rerender(
            <MikeLayout>
                <div>Projects</div>
            </MikeLayout>,
        );

        expect(sidebarState.isOpen).toBe(true);
    });
});

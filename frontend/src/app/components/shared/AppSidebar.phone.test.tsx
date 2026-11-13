import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listProjectsPage } from "@/app/lib/mikeApi";
import { AppSidebar } from "./AppSidebar";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => "/assistant",
}));
vi.mock("next/image", () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock("@/app/lib/mikeApi", () => ({ listProjectsPage: vi.fn() }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "sidebar-user", email: "alice@example.com" },
        signOut: vi.fn(),
    }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { displayName: "Alice", tier: "Free" } }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({
        chats: [],
        loadingMoreChats: false,
        loadMoreChats: vi.fn(),
        setCurrentChatId: vi.fn(),
    }),
}));

function stubViewport(phone: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: phone && query === "(max-width: 767px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
    }));
}

describe("AppSidebar on a phone", () => {
    beforeEach(() => {
        vi.mocked(listProjectsPage).mockResolvedValue([]);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("is always laid out and slid with transform, not the width: closed it is inert and invisible", () => {
        stubViewport(true);
        const { container } = render(<AppSidebar isOpen={false} onToggle={vi.fn()} />);
        const panel = container.querySelector<HTMLElement>("#app-sidebar")!;
        expect(panel).toHaveAttribute("inert");
        expect(panel).not.toHaveAttribute("role");
        expect(panel.className).toContain("max-md:invisible");
        expect(panel.className).toContain("max-md:[transform:translateX(");
        expect(panel.className).toContain("max-md:duration-[180ms]");
        // Its contents are the full ones, so they do not pop in as it slides.
        expect(panel).toHaveTextContent("Recent Projects");
    });

    it("open: a modal dialog with a named navigation, 250 ms in, a veil of ink", () => {
        stubViewport(true);
        const { container } = render(<AppSidebar isOpen onToggle={vi.fn()} />);
        const panel = screen.getByRole("dialog", { name: "Main navigation" });
        expect(panel).toHaveAttribute("aria-modal", "true");
        expect(panel).not.toHaveAttribute("inert");
        expect(panel.className).toContain("max-md:duration-[250ms]");
        expect(panel.className).toContain("max-md:[transform:none]");
        expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
        const veil = container.querySelector<HTMLElement>("div[aria-hidden='true'].fixed")!;
        expect(veil.className).toContain("var(--litt-tinta)_25%");
    });

    it("moves focus in on opening, closes on Escape, and gives focus back to its trigger", async () => {
        stubViewport(true);
        const onToggle = vi.fn();
        const trigger = document.createElement("button");
        trigger.setAttribute("data-sidebar-trigger", "");
        document.body.append(trigger);
        const { rerender } = render(<AppSidebar isOpen={false} onToggle={onToggle} />);
        rerender(<AppSidebar isOpen onToggle={onToggle} />);
        expect(document.activeElement).toBe(
            screen.getByRole("button", { name: "Close sidebar" }),
        );
        await userEvent.keyboard("{Escape}");
        expect(onToggle).toHaveBeenCalledOnce();
        rerender(<AppSidebar isOpen={false} onToggle={onToggle} />);
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it("from md up it is no dialog, never inert, and keeps a named navigation", () => {
        stubViewport(false);
        const { container } = render(<AppSidebar isOpen={false} onToggle={vi.fn()} />);
        const panel = container.querySelector<HTMLElement>("#app-sidebar")!;
        expect(panel).not.toHaveAttribute("inert");
        expect(panel).not.toHaveAttribute("role");
        expect(panel.className).toContain("md:transition-[width,border-radius]");
        expect(panel.className).toContain("md:duration-200");
        expect(panel.className).not.toContain("transition-all");
        expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    });
});

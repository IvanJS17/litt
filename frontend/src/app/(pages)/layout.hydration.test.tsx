import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import MikeLayout from "./layout";

const state = vi.hoisted(() => ({ loading: true }));
vi.mock("next/navigation", () => ({
    usePathname: () => "/projects",
    useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ authLoading: state.loading, isAuthenticated: !state.loading }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    ChatHistoryProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/shared/AppSidebar", () => ({ AppSidebar: () => <aside>Sidebar</aside> }));

it("preloads account-menu icons in the server loading shell before the menu mounts", () => {
    state.loading = true;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<MikeLayout><p>Workspace</p></MikeLayout>);
    expect(container).not.toHaveTextContent("Sidebar");
    const images = Array.from(container.querySelectorAll('link[rel="preload"][as="image"]'))
        .map((link) => link.getAttribute("href"));
    for (const path of ["/icons/settings.svg", "/icons/features/organization.svg", "/icons/sign-out.svg"]) {
        expect(images).toContainEqual(expect.stringContaining(path));
    }
});

// Hydrating after the session settled is covered where the guarantee now
// lives: contexts/AuthContext.hydration.test.tsx.

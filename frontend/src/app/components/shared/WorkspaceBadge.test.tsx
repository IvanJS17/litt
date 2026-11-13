import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceBadge } from "./WorkspaceBadge";

const state = vi.hoisted(() => ({
    workspaceId: null as string | null,
    activeOrganization: null as { id: string; name: string } | null,
}));

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => state,
}));

describe("WorkspaceBadge", () => {
    beforeEach(() => {
        state.workspaceId = null;
        state.activeOrganization = null;
    });

    it("says the personal workspace is open", () => {
        state.workspaceId = "personal";
        render(<WorkspaceBadge />);
        expect(screen.getByText("My personal workspace")).toBeVisible();
        expect(document.querySelector('[data-workspace="personal"]')).not.toBeNull();
    });

    it("names the firm whose workspace is open", () => {
        state.workspaceId = "org-1";
        state.activeOrganization = { id: "org-1", name: "Socium" };
        render(<WorkspaceBadge className="extra" />);
        expect(screen.getByText("Firm: Socium")).toBeVisible();
        expect(document.querySelector('[data-workspace="firm"]')).toHaveClass("extra");
    });

    it("names nothing while a remembered firm is still loading, and outside a workspace", () => {
        state.workspaceId = "org-1";
        const { container, rerender } = render(<WorkspaceBadge />);
        expect(container).toBeEmptyDOMElement();
        state.workspaceId = null;
        rerender(<WorkspaceBadge />);
        expect(container).toBeEmptyDOMElement();
    });
});

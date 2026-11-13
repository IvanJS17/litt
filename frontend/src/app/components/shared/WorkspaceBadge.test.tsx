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
        const badge = document.querySelector('[data-workspace="firm"]');
        expect(badge).toHaveTextContent("Firm: Socium");
        expect(badge).toHaveClass("extra");
        // Words with an icon, not a bordered pill.
        expect(badge?.className).not.toMatch(/border|rounded|font-semibold/);
        expect(badge?.querySelector("svg")).not.toBeNull();
    });

    it("lets a long firm name wrap instead of cutting it", () => {
        state.workspaceId = "org-1";
        state.activeOrganization = { id: "org-1", name: "Despacho Jurídico González, Hernández y Asociados" };
        render(<WorkspaceBadge />);
        const name = screen.getByText("Despacho Jurídico González, Hernández y Asociados");
        expect(name.parentElement?.className).toContain("break-words");
        expect(document.querySelector('[data-slot="workspace-badge"]')?.innerHTML).not.toContain("truncate");
    });

    it("does not repeat the firm's name where the screen already shows it", () => {
        state.workspaceId = "org-1";
        state.activeOrganization = { id: "org-1", name: "Socium" };
        render(<WorkspaceBadge showName={false} />);
        expect(document.querySelector('[data-workspace="firm"]')).toHaveTextContent(/^Firm$/);
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

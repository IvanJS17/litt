import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalKeysBlockedNotice, useKeyScope, usePersonalKeysScope } from "./KeyScope";

const workspace = vi.hoisted(() => ({
    firm: null as null | { name: string },
    orgApiKeys: null as null | { allow_personal_keys: { ai: boolean, web_search: boolean, scan: boolean } },
}));
vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({ activeOrganization: workspace.firm, orgApiKeys: workspace.orgApiKeys }),
}));

const profile = vi.hoisted(() => ({ managed: false }));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { personalWorkspaceDisabled: profile.managed } }),
}));

describe("key scope", () => {
    beforeEach(() => {
        workspace.firm = null;
        workspace.orgApiKeys = null;
        profile.managed = false;
    });

    it("is never blocked in the personal workspace", () => {
        workspace.orgApiKeys = { allow_personal_keys: { ai: false, web_search: false, scan: false } };
        const { result } = renderHook(() => useKeyScope());
        expect(result.current).toEqual({ firmName: null, personalBlocked: false, managed: false, orgApiKeys: null });
    });

    it("never has personal keys for a firm-managed account, in any workspace", () => {
        profile.managed = true;
        const { result } = renderHook(() => useKeyScope());
        expect(result.current).toEqual({ firmName: null, personalBlocked: true, managed: true, orgApiKeys: null });
    });

    it("is blocked only once the firm is known to turn members' own keys off", () => {
        workspace.firm = { name: "Socium" };
        const { result, rerender } = renderHook(() => useKeyScope());
        // Still loading, or the read failed: not blocked; the server decides.
        expect(result.current).toEqual({ firmName: "Socium", personalBlocked: false, managed: false, orgApiKeys: null });
        workspace.orgApiKeys = { allow_personal_keys: { ai: true, web_search: true, scan: true } };
        rerender();
        expect(result.current.personalBlocked).toBe(false);
        workspace.orgApiKeys = { allow_personal_keys: { ai: false, web_search: false, scan: false } };
        rerender();
        expect(result.current.personalBlocked).toBe(true);
    });

    it("decides each capability on its own switch", () => {
        workspace.firm = { name: "Socium" };
        workspace.orgApiKeys = { allow_personal_keys: { ai: true, web_search: false, scan: true } };
        const blocked = (capability?: "ai" | "web_search" | "scan") =>
            renderHook(() => useKeyScope(capability)).result.current.personalBlocked;
        expect(blocked()).toBe(false);
        expect(blocked("ai")).toBe(false);
        expect(blocked("web_search")).toBe(true);
        expect(blocked("scan")).toBe(false);
        workspace.orgApiKeys = { allow_personal_keys: { ai: false, web_search: true, scan: false } };
        expect(blocked("ai")).toBe(true);
        expect(blocked("web_search")).toBe(false);
        expect(blocked("scan")).toBe(true);
    });

    it("blocks every capability for a firm-managed account", () => {
        profile.managed = true;
        for (const capability of ["ai", "web_search", "scan"] as const)
            expect(renderHook(() => useKeyScope(capability)).result.current.personalBlocked).toBe(true);
    });

    it("words where the keys apply, and the notice when they do not", () => {
        const { result } = renderHook(() => usePersonalKeysScope());
        expect(result.current).toBe("These keys are yours and apply to your personal workspace.");
        workspace.firm = { name: "Socium" };
        render(<PersonalKeysBlockedNotice />);
        expect(
            screen.getByText("You work with the keys of Socium. Your firm does not allow using your own keys for this."),
        ).toBeVisible();
    });

    it("has no subject-less notice while the firm's name has not loaded", () => {
        profile.managed = true;
        const { container } = render(<PersonalKeysBlockedNotice />);
        expect(container.textContent?.startsWith(" ")).toBe(false);
        expect(screen.getByText("You work with your firm's keys. Your firm does not allow using your own keys for this.")).toBeVisible();
    });
});

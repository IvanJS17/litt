import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalKeysBlockedNotice, useKeyScope, usePersonalKeysScope } from "./KeyScope";

const workspace = vi.hoisted(() => ({
    firm: null as null | { name: string },
    orgApiKeys: null as null | { allow_personal_api_keys: boolean },
}));
vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({ activeOrganization: workspace.firm, orgApiKeys: workspace.orgApiKeys }),
}));

describe("key scope", () => {
    beforeEach(() => {
        workspace.firm = null;
        workspace.orgApiKeys = null;
    });

    it("is never blocked in the personal workspace", () => {
        workspace.orgApiKeys = { allow_personal_api_keys: false };
        const { result } = renderHook(() => useKeyScope());
        expect(result.current).toEqual({ firmName: null, personalBlocked: false });
    });

    it("is blocked only once the firm is known to turn members' own keys off", () => {
        workspace.firm = { name: "Socium" };
        const { result, rerender } = renderHook(() => useKeyScope());
        // Still loading, or the read failed: not blocked; the server decides.
        expect(result.current).toEqual({ firmName: "Socium", personalBlocked: false });
        workspace.orgApiKeys = { allow_personal_api_keys: true };
        rerender();
        expect(result.current.personalBlocked).toBe(false);
        workspace.orgApiKeys = { allow_personal_api_keys: false };
        rerender();
        expect(result.current.personalBlocked).toBe(true);
    });

    it("words where the keys apply, and the notice when they do not", () => {
        const { result } = renderHook(() => usePersonalKeysScope());
        expect(result.current).toBe("These keys are yours and apply to your personal workspace.");
        workspace.firm = { name: "Socium" };
        render(<PersonalKeysBlockedNotice />);
        expect(
            screen.getByText("Socium gives you the models; your firm does not allow your own keys."),
        ).toBeVisible();
    });
});

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ByokPage from "./page";

const scope = vi.hoisted(() => ({
    personalBlocked: false,
    managed: false,
    firmName: null as string | null,
}));
vi.mock("@/app/components/settings/KeyScope", () => ({
    useKeyScope: () => ({ ...scope, orgApiKeys: null }),
    PersonalKeysBlockedNotice: () => (
        <p>{scope.firmName} gives you the models; your firm does not allow your own keys.</p>
    ),
}));
const workspace = vi.hoisted(() => ({ activeOrganization: null as null | { id: string; name: string } }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspace: () => workspace,
}));
vi.mock("@/app/components/settings/PersonalProviderKeys", () => ({
    PersonalProviderKeys: () => <p>own keys form</p>,
}));
vi.mock("@/app/components/organizations/OrganizationProviderKeys", () => ({
    OrganizationProviderKeys: ({ orgId, orgName }: { orgId: string; orgName: string }) => (
        <p>
            Firm keys ({orgName}) {orgId}
        </p>
    ),
}));

beforeEach(() => {
    scope.personalBlocked = false;
    scope.managed = false;
    scope.firmName = null;
    workspace.activeOrganization = null;
});

describe("Settings > keys page", () => {
    it("shows the person's own keys when they apply", () => {
        render(<ByokPage />);
        expect(screen.getByText("My personal keys")).toBeVisible();
        expect(screen.getByText("own keys form")).toBeVisible();
    });

    it("shows a managed member the firm's keys and why, never a blank page", () => {
        scope.managed = true;
        scope.personalBlocked = true;
        scope.firmName = "Despacho Demo";
        workspace.activeOrganization = { id: "firm-1", name: "Despacho Demo" };
        const { container } = render(<ByokPage />);
        expect(container).not.toBeEmptyDOMElement();
        expect(screen.getByText(/^Despacho Demo gives you the models;/)).toBeVisible();
        expect(screen.getByText("Firm keys (Despacho Demo) firm-1")).toBeVisible();
        expect(screen.queryByText("own keys form")).toBeNull();
    });

    it("does the same where a firm only turns members' own keys off", () => {
        scope.personalBlocked = true;
        scope.firmName = "Socium";
        workspace.activeOrganization = { id: "firm-2", name: "Socium" };
        render(<ByokPage />);
        expect(screen.getByText("Firm keys (Socium) firm-2")).toBeVisible();
        expect(screen.queryByText("own keys form")).toBeNull();
    });

    it("shows a placeholder, not a blank page, while the managed account's firm loads", () => {
        scope.managed = true;
        scope.personalBlocked = true;
        const { container } = render(<ByokPage />);
        expect(container.querySelector(".animate-pulse")).not.toBeNull();
    });
});

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirmCriteriaSettingsPage from "./page";

// «Criterios del despacho» moved to the firm's settings → Formación; the old
// address goes to the active firm's page, or to the person's firms.

const mocks = vi.hoisted(() => ({
    replace: vi.fn(),
    organizations: [] as { id: string }[] | null,
    activeOrganization: null as { id: string } | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspace: () => ({ organizations: mocks.organizations, activeOrganization: mocks.activeOrganization }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizations = [{ id: "org-1" }, { id: "org-2" }];
    mocks.activeOrganization = { id: "org-2" };
});

describe("/settings/firm-criteria", () => {
    it("goes to the active firm's Formación, at the criteria", () => {
        render(<FirmCriteriaSettingsPage />);
        expect(mocks.replace).toHaveBeenCalledWith("/organizations/org-2/settings/training#criterios-del-despacho");
    });

    it("goes to the first firm when none is active", () => {
        mocks.activeOrganization = null;
        render(<FirmCriteriaSettingsPage />);
        expect(mocks.replace).toHaveBeenCalledWith("/organizations/org-1/settings/training#criterios-del-despacho");
    });

    it("waits while the firms load, and falls back to the person's firms when there is none", () => {
        mocks.organizations = null;
        const { rerender } = render(<FirmCriteriaSettingsPage />);
        expect(mocks.replace).not.toHaveBeenCalled();
        mocks.organizations = [];
        mocks.activeOrganization = null;
        rerender(<FirmCriteriaSettingsPage />);
        expect(mocks.replace).toHaveBeenCalledWith("/settings/organizations");
    });
});

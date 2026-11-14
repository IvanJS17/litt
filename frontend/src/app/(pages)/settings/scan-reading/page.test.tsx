import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScanReadingPage from "./page";

const state = vi.hoisted(() => ({
    firm: null as null | { name: string; role?: string },
    managed: false,
}));

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({
        activeOrganization: state.firm && { id: "firm-1", role: "admin", ...state.firm },
        orgApiKeys: null,
    }),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getUserSplitClasses: vi.fn(() => new Promise(() => {})),
    saveUserSplitClasses: vi.fn(),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: { personalWorkspaceDisabled: state.managed },
    }),
}));

vi.mock("@/app/components/settings/ScanReadingSection", () => ({
    ScanReadingSection: () => <p>my scan reading</p>,
}));

describe("ScanReadingPage document types to split a case file", () => {
    const card = () => screen.queryByRole("region", { name: "Document types for splitting a file" });

    beforeEach(() => {
        state.firm = null;
        state.managed = false;
    });

    it("shows the person's key and the personal list in the personal workspace", () => {
        render(<ScanReadingPage />);
        expect(screen.getByText("my scan reading")).toBeInTheDocument();
        expect(card()).toBeInTheDocument();
    });

    it("does not repeat the firm's list inside a firm's workspace: it links to it for an administrator", () => {
        state.firm = { name: "Socium" };
        render(<ScanReadingPage />);
        expect(card()).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Firm settings → Scanned document reading" })).toHaveAttribute(
            "href",
            "/organizations/firm-1/settings/scan-reading",
        );
    });

    it("tells a member who manages it, without a link to a page they are not offered", () => {
        state.firm = { name: "Socium", role: "member" };
        render(<ScanReadingPage />);
        expect(card()).not.toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.getByText(/Your firm manages this when you work in Socium/)).toBeInTheDocument();
    });

    it("has no personal list for a firm-managed account, which has no personal workspace", () => {
        state.managed = true;
        render(<ScanReadingPage />);
        expect(card()).not.toBeInTheDocument();
    });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganizationStorageSettingsPage from "./page";

const mocks = vi.hoisted(() => ({
    role: "owner" as "owner" | "admin" | "member",
    push: vi.fn(),
    org: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/components/organizations/OrganizationSettingsShell", () => ({
    organizationSettingsHref: (orgId: string) => `/organizations/${orgId}/settings`,
    useOrganizationSettings: () => ({ orgId: "org-1", org: { id: "org-1", role: mocks.role } }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getOrgStorageUsage: mocks.org,
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "owner";
    mocks.org.mockResolvedValue({ usedBytes: 3 * 1024 ** 3, limitBytes: 30 * 1024 ** 3 });
});

describe("Firm settings > Storage", () => {
    it.each(["owner", "admin"] as const)("shows the firm's space to an %s", async (role) => {
        mocks.role = role;
        render(<OrganizationStorageSettingsPage />);
        expect(await screen.findByText("3.0 GB of 30.0 GB in use")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Firm storage" })).toBeInTheDocument();
        expect(mocks.org).toHaveBeenCalledWith("org-1", expect.any(AbortSignal));
    });

    it("tells a plain member it is not available to them, without asking the server", async () => {
        mocks.role = "member";
        render(<OrganizationStorageSettingsPage />);
        expect(screen.getByText("These settings are not available.")).toBeInTheDocument();
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
        expect(mocks.org).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", { name: "Back to General" }));
        expect(mocks.push).toHaveBeenCalledWith("/organizations/org-1/settings");
    });
});

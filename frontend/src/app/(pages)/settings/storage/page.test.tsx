import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StorageSettingsPage from "./page";

const api = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getUserStorageUsage: api.user,
    getOrgStorageUsage: api.org,
}));

beforeEach(() => vi.clearAllMocks());

describe("Settings > Storage", () => {
    it("shows the person's own space and asks for no firm's", async () => {
        api.user.mockResolvedValue({ usedBytes: 1024 ** 3, limitBytes: 2 * 1024 ** 3 });
        render(<StorageSettingsPage />);
        expect(screen.getByRole("heading", { name: "Your storage" })).toBeInTheDocument();
        expect(await screen.findByText("1.0 GB of 2.0 GB in use")).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
        expect(api.org).not.toHaveBeenCalled();
    });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAppsSection } from "./ConnectedAppsSection";
import { MikeApiError, listMcpGrants, revokeMcpGrant, type McpGrant } from "@/app/lib/mikeApi";

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({ organizations: [{ id: "org-1", name: "Firm A" }] }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listMcpGrants: vi.fn(),
    revokeMcpGrant: vi.fn(),
}));

const grant = (over: Partial<McpGrant> = {}): McpGrant => ({
    id: "g1",
    client_id: "c1",
    client_name: "Claude",
    scopes: ["litt.read", "litt.chat"],
    workspaces: ["personal", "org-1"],
    default_workspace: "personal",
    created_at: "2026-11-01T12:00:00.000Z",
    last_used_at: "2026-11-15T12:00:00.000Z",
    expires_at: "2027-01-30T12:00:00.000Z",
    ...over,
});

const apiError = (status: number) => new MikeApiError({ message: "x", status, code: null });

beforeEach(() => {
    vi.mocked(listMcpGrants).mockReset();
    vi.mocked(revokeMcpGrant).mockReset();
});
afterEach(cleanup);

describe("ConnectedAppsSection", () => {
    it("lists each connection with app, workspaces, permissions and dates", async () => {
        vi.mocked(listMcpGrants).mockResolvedValue([grant(), grant({ id: "g2", client_name: "Hermes", scopes: ["litt.run", "custom"], workspaces: ["org-9"], last_used_at: null })]);
        render(<ConnectedAppsSection />);
        expect(screen.getByText("Loading…")).toBeTruthy();
        const claude = (await screen.findByText("Claude")).closest("li")!;
        expect(within(claude).getByText(/Workspaces: Personal, Firm A/)).toBeTruthy();
        expect(within(claude).getByText(/Permissions: Read, Assistant/)).toBeTruthy();
        expect(within(claude).getByText(/Connected on .*Last used: .*Access ends on/)).toBeTruthy();
        const hermes = screen.getByText("Hermes").closest("li")!;
        expect(within(hermes).getByText(/Workspaces: Firm$/)).toBeTruthy();
        expect(within(hermes).getByText(/Permissions: Run tasks, custom/)).toBeTruthy();
        expect(within(hermes).getByText(/Not used yet/)).toBeTruthy();
    });

    it("shows an empty state", async () => {
        vi.mocked(listMcpGrants).mockResolvedValue([]);
        render(<ConnectedAppsSection />);
        expect(await screen.findByText(/You have not connected any app yet/)).toBeTruthy();
    });

    it("explains that connections are off when the server answers 404", async () => {
        vi.mocked(listMcpGrants).mockImplementation(() => Promise.reject(apiError(404)));
        render(<ConnectedAppsSection />);
        expect(await screen.findByText(/does not have connections with AI apps turned on/)).toBeTruthy();
        expect(screen.queryByText(/You have not connected/)).toBeNull();
    });

    it("reports another failure and shows an empty list", async () => {
        vi.mocked(listMcpGrants).mockImplementation(() => Promise.reject(apiError(500)));
        render(<ConnectedAppsSection />);
        expect(await screen.findByText(/You have not connected any app yet/)).toBeTruthy();
        expect(await screen.findByRole("alert")).toBeTruthy();
    });

    it("asks before removing access, then removes the row", async () => {
        vi.mocked(listMcpGrants).mockResolvedValue([grant()]);
        vi.mocked(revokeMcpGrant).mockResolvedValue(undefined);
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        expect(revokeMcpGrant).not.toHaveBeenCalled();
        expect(screen.getByText("Remove Claude's access?")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        await waitFor(() => expect(revokeMcpGrant).toHaveBeenCalledWith("g1"));
        await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
    });

    it("lets the person back out of the confirmation", async () => {
        vi.mocked(listMcpGrants).mockResolvedValue([grant()]);
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.getByRole("button", { name: "Remove access" })).toBeTruthy();
        expect(revokeMcpGrant).not.toHaveBeenCalled();
    });

    it("drops a row that was already revoked elsewhere", async () => {
        vi.mocked(listMcpGrants).mockResolvedValue([grant()]);
        vi.mocked(revokeMcpGrant).mockImplementation(() => Promise.reject(apiError(404)));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
    });

    it("keeps the row and reports when removing fails", async () => {
        vi.mocked(listMcpGrants).mockResolvedValue([grant()]);
        vi.mocked(revokeMcpGrant).mockImplementation(() => Promise.reject(apiError(500)));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.getByText("Claude")).toBeTruthy();
    });
});

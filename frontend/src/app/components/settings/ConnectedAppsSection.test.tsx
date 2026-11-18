import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAppsSection } from "./ConnectedAppsSection";
import { MikeApiError, getMcpGrantActivity, listMcpGrants, revokeMcpGrant, type McpGrant, type McpGrantActivity } from "@/app/lib/mikeApi";

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({ organizations: [{ id: "org-1", name: "Firm A" }] }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listMcpGrants: vi.fn(),
    revokeMcpGrant: vi.fn(),
    getMcpGrantActivity: vi.fn(),
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

const SERVER_URL = "https://mcp.test.example/mcp";
const mockList = (grants: McpGrant[]) =>
    vi.mocked(listMcpGrants).mockResolvedValue({ grants, server_url: SERVER_URL });

const apiError = (status: number) => new MikeApiError({ message: "x", status, code: null });

beforeEach(() => {
    vi.mocked(listMcpGrants).mockReset();
    vi.mocked(revokeMcpGrant).mockReset();
    vi.mocked(getMcpGrantActivity).mockReset();
});
afterEach(cleanup);

describe("ConnectedAppsSection", () => {
    it("lists each connection with app, workspaces, permissions and dates", async () => {
        mockList([grant(), grant({ id: "g2", client_name: "Hermes", scopes: ["litt.run", "custom"], workspaces: ["org-9"], last_used_at: null })]);
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
        mockList([]);
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
        mockList([grant()]);
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
        mockList([grant()]);
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.getByRole("button", { name: "Remove access" })).toBeTruthy();
        expect(revokeMcpGrant).not.toHaveBeenCalled();
    });

    it("drops a row that was already revoked elsewhere", async () => {
        mockList([grant()]);
        vi.mocked(revokeMcpGrant).mockImplementation(() => Promise.reject(apiError(404)));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
    });

    it("keeps the row and reports when removing fails", async () => {
        mockList([grant()]);
        vi.mocked(revokeMcpGrant).mockImplementation(() => Promise.reject(apiError(500)));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.getByText("Claude")).toBeTruthy();
    });
});

describe("ConnectedAppsSection connect guide", () => {
    it("shows the server's address with a copy button and the official steps", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        mockList([]);
        render(<ConnectedAppsSection />);
        expect(await screen.findByText("Connect LiTT to Claude or ChatGPT")).toBeTruthy();
        expect(screen.getByText(SERVER_URL)).toBeTruthy();
        expect(screen.getByText(/Add custom connector/)).toBeTruthy();
        expect(screen.getByText(/Add custom MCP server/)).toBeTruthy();
        expect(screen.getByText(/Plus or Pro account you may not have this option/)).toBeTruthy();
        expect(screen.getByRole("link", { name: "Claude's official guide" }).getAttribute("href")).toBe(
            "https://support.claude.com/en/articles/11175166",
        );
        expect(screen.getByRole("link", { name: "ChatGPT's official guide" }).getAttribute("href")).toBe(
            "https://help.openai.com/en/articles/12584461",
        );
        fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(SERVER_URL));
        expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
        expect(screen.getByRole("status").textContent).toBe("Copied");
    });

    it("also shows it above existing connections", async () => {
        mockList([grant()]);
        render(<ConnectedAppsSection />);
        expect(await screen.findByText(SERVER_URL)).toBeTruthy();
        expect(screen.getByText("Claude")).toBeTruthy();
    });

    it("is not shown when the server has connections turned off", async () => {
        vi.mocked(listMcpGrants).mockImplementation(() => Promise.reject(apiError(404)));
        render(<ConnectedAppsSection />);
        await screen.findByText(/does not have connections with AI apps turned on/);
        expect(screen.queryByText("Connect LiTT to Claude or ChatGPT")).toBeNull();
    });
});

describe("ConnectedAppsSection activity", () => {
    const activity = (over: Partial<McpGrantActivity> = {}): McpGrantActivity => ({
        calls: [
            { tool: "start_chat", at: "2026-11-16T10:00:00.000Z", workspace: "org-1", outcome: "ok" },
            { tool: "get_chat", at: "2026-11-16T09:00:00.000Z", workspace: null, outcome: "denied" },
            { tool: "list_chats", at: "2026-11-16T08:00:00.000Z", workspace: "personal", outcome: "rate_limited" },
        ],
        chats: [
            { id: "c1", title: "Renta del contrato", project_id: null, workspace: "personal", created_at: "2026-11-16T10:00:01.000Z" },
            { id: "c2", title: "  ", project_id: "p1", workspace: "org-1", created_at: "2026-11-16T10:05:00.000Z" },
        ],
        ...over,
    });

    it("shows what the app did and the conversations it started, with links, only when asked", async () => {
        mockList([grant()]);
        vi.mocked(getMcpGrantActivity).mockResolvedValue(activity());
        render(<ConnectedAppsSection />);
        const toggle = await screen.findByRole("button", { name: "Show activity" });
        expect(getMcpGrantActivity).not.toHaveBeenCalled();
        fireEvent.click(toggle);
        expect(screen.getByText("Loading activity…")).toBeTruthy();
        expect(await screen.findByText("Recent activity")).toBeTruthy();
        expect(getMcpGrantActivity).toHaveBeenCalledWith("g1");
        expect(screen.getByText(/^start_chat · .* · Firm A · Done$/)).toBeTruthy();
        expect(screen.getByText(/^get_chat · .* · No workspace · Not allowed$/)).toBeTruthy();
        expect(screen.getByText(/^list_chats · .* · Personal · Too many requests$/)).toBeTruthy();
        expect(screen.getByText(/never the content/)).toBeTruthy();
        expect(screen.getByRole("link", { name: "Renta del contrato" }).getAttribute("href")).toBe("/assistant/chat/c1");
        expect(screen.getByRole("link", { name: "Untitled conversation" }).getAttribute("href")).toBe("/projects/p1/assistant/chat/c2");
        fireEvent.click(screen.getByRole("button", { name: "Hide activity" }));
        expect(screen.queryByText("Recent activity")).toBeNull();
    });

    it("says so when the app has done nothing and started nothing", async () => {
        mockList([grant()]);
        vi.mocked(getMcpGrantActivity).mockResolvedValue(activity({ calls: [], chats: [] }));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Show activity" }));
        expect(await screen.findByText("This app has not done anything yet.")).toBeTruthy();
        expect(screen.getByText(/has not started any conversation/)).toBeTruthy();
    });

    it("reports a failure to load and shows an empty record", async () => {
        mockList([grant()]);
        vi.mocked(getMcpGrantActivity).mockImplementation(() => Promise.reject(apiError(500)));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Show activity" }));
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(await screen.findByText("This app has not done anything yet.")).toBeTruthy();
    });

    it("ignores an answer that arrives after the panel was closed", async () => {
        mockList([grant()]);
        let finish!: (value: McpGrantActivity) => void;
        let fail!: (reason: unknown) => void;
        vi.mocked(getMcpGrantActivity)
            .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
            .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Show activity" }));
        fireEvent.click(screen.getByRole("button", { name: "Hide activity" }));
        finish(activity());
        fireEvent.click(screen.getByRole("button", { name: "Show activity" }));
        fireEvent.click(screen.getByRole("button", { name: "Hide activity" }));
        fail(apiError(500));
        await Promise.resolve();
        expect(screen.queryByText("Recent activity")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("closes the panel when the connection is removed", async () => {
        mockList([grant(), grant({ id: "g2", client_name: "Hermes" })]);
        vi.mocked(getMcpGrantActivity).mockResolvedValue(activity());
        vi.mocked(revokeMcpGrant).mockResolvedValue(undefined);
        render(<ConnectedAppsSection />);
        fireEvent.click((await screen.findAllByRole("button", { name: "Show activity" }))[0]);
        await screen.findByText("Recent activity");
        fireEvent.click(screen.getAllByRole("button", { name: "Remove access" })[0]);
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        await waitFor(() => expect(screen.queryByText("Recent activity")).toBeNull());
        expect(screen.getByText("Hermes")).toBeTruthy();
    });
});

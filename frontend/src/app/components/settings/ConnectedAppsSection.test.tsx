import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAppsSection } from "./ConnectedAppsSection";
import { notifySuccess } from "@/app/lib/userFacingError";
import { MikeApiError, getMcpGrantActivity, listMcpGrants, revokeMcpGrant, type McpGrant, type McpGrantActivity } from "@/app/lib/mikeApi";

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { email: EMAIL } }),
}));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
    notifySuccess: vi.fn(),
}));
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

const EMAIL = "maria.fernanda.villarreal-santos@gonzalez-villarreal-asociados.com.mx";

const grant = (over: Partial<McpGrant> = {}): McpGrant => ({
    id: "g1",
    client_id: "c1",
    client_name: "Claude",
    app: null,
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
    it("lists each connection with what it can and cannot do, where, and dates", async () => {
        mockList([grant(), grant({ id: "g2", client_name: "Hermes", scopes: ["litt.run", "custom"], workspaces: ["org-9"], last_used_at: null })]);
        render(<ConnectedAppsSection />);
        expect(screen.getByText("Loading…")).toBeTruthy();
        const claude = (await screen.findByRole("heading", { name: "Claude" })).closest("article")!;
        // The consent screen's own phrases, per scope.
        expect(within(claude).getByText("What it can do")).toBeTruthy();
        expect(within(claude).getByText("Read your matters, documents and results.")).toBeTruthy();
        expect(within(claude).getByText("Use the LiTT assistant for you.")).toBeTruthy();
        expect(within(claude).getByText("Cannot: Run tasks, Save and upload.")).toBeTruthy();
        // One workspace per line, the default marked, no joined list.
        expect(within(claude).getByText("Where it can work")).toBeTruthy();
        expect(within(claude).getByText("Personal").closest("li")!.textContent).toMatch(/default/);
        expect(within(claude).getByText("Firm A").closest("li")!.textContent).not.toMatch(/default/);
        expect(within(claude).getByText(/Last used: /)).toBeTruthy();
        expect(within(claude).getByText(/Connected on .* · Access ends on/)).toBeTruthy();
        const hermes = screen.getByRole("heading", { name: "Hermes" }).closest("article")!;
        expect(within(hermes).getByText("Firm")).toBeTruthy();
        expect(within(hermes).getByText("Run tasks")).toBeTruthy();
        expect(within(hermes).getByText("custom")).toBeTruthy();
        expect(within(hermes).getByText("Not used yet")).toBeTruthy();
    });

    it("says whose account the apps use, with the whole email", async () => {
        mockList([grant()]);
        render(<ConnectedAppsSection />);
        const line = (await screen.findByText(/They use your account:/)).closest("p")!;
        expect(line.textContent).toContain(EMAIL);
        expect(within(line).getByText(EMAIL).className).not.toMatch(/truncate|line-clamp|ellipsis/);
    });

    it("shows a brand logo only when the server recognised the app, a generic icon otherwise", async () => {
        mockList([
            grant({ id: "g1", client_name: "Claude", app: "claude" }),
            grant({ id: "g2", client_name: "ChatGPT", app: "chatgpt" }),
            // Calls itself Claude but the server did not recognise it.
            grant({ id: "g3", client_name: "Claude", app: null }),
        ]);
        const { container } = render(<ConnectedAppsSection />);
        await screen.findAllByRole("heading", { name: "Claude" });
        const icons = [...container.querySelectorAll('article [data-slot="connected-app-icon"]')];
        expect(icons.map((icon) => icon.getAttribute("data-app"))).toEqual(["claude", "chatgpt", "generic"]);
        expect(icons[0].querySelector("img")!.getAttribute("src")).toContain("anthropic.svg");
        expect(icons[1].querySelector("img")!.getAttribute("src")).toContain("openai.svg");
        expect(icons[2].querySelector("img")).toBeNull();
        expect(icons[2].querySelector("svg")).toBeTruthy();
    });

    it("puts the connect guide first with no connections and the list first with some", async () => {
        mockList([]);
        const empty = render(<ConnectedAppsSection />);
        await screen.findByText(/You have not connected any app yet/);
        const order = (root: HTMLElement) =>
            [...root.querySelectorAll("h2")].map((h) => h.textContent);
        expect(order(empty.container)).toEqual(["Connect LiTT to Claude or ChatGPT", "Apps with access to your account"]);
        // With nothing connected the Claude steps are already open.
        expect(screen.getByText(/Add custom connector/)).toBeTruthy();
        empty.unmount();

        mockList([grant()]);
        const full = render(<ConnectedAppsSection />);
        await screen.findByRole("heading", { name: "Claude" });
        expect(order(full.container)).toEqual(["Apps with access to your account", "Connect LiTT to Claude or ChatGPT"]);
        // Folded: the address stays, the steps wait for the person to pick an app.
        expect(screen.getByText(SERVER_URL)).toBeTruthy();
        expect(screen.queryByText(/Add custom connector/)).toBeNull();
        expect(screen.getByText("1 app")).toBeTruthy();
    });

    it("moves the guide below the list when the first connection appears", async () => {
        mockList([grant()]);
        vi.mocked(revokeMcpGrant).mockResolvedValue(undefined);
        const { container } = render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
        await screen.findByText(/You have not connected any app yet/);
        expect([...container.querySelectorAll("h2")].map((h) => h.textContent)[0]).toBe("Connect LiTT to Claude or ChatGPT");
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
        expect(notifySuccess).toHaveBeenCalledWith("You removed Claude's access.");
        expect(document.activeElement?.textContent).toBe("Apps with access to your account");
    });

    it("moves focus to Cancel when asking to confirm", async () => {
        mockList([grant()]);
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
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
    it("shows the server's address with a copy button and one app's steps at a time", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        mockList([]);
        render(<ConnectedAppsSection />);
        expect(await screen.findByText("Connect LiTT to Claude or ChatGPT")).toBeTruthy();
        expect(screen.getByText(SERVER_URL)).toBeTruthy();
        // Claude's tab: four steps, its team note and its official guide; none of ChatGPT's.
        expect(screen.getByText(/Add custom connector/)).toBeTruthy();
        expect(screen.getByText(/Organization settings/)).toBeTruthy();
        expect(screen.queryByText(/Add custom MCP server/)).toBeNull();
        expect(screen.getAllByRole("listitem").filter((li) => li.closest("ol"))).toHaveLength(4);
        expect(screen.getByRole("link", { name: "Claude's official guide" }).getAttribute("href")).toBe(
            "https://support.claude.com/en/articles/11175166",
        );
        expect(screen.getByRole("button", { name: "With Claude" }).getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(screen.getByRole("button", { name: "With ChatGPT" }));
        expect(screen.getByRole("button", { name: "With ChatGPT" }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.queryByText(/Add custom connector/)).toBeNull();
        expect(screen.getAllByRole("listitem").filter((li) => li.closest("ol"))).toHaveLength(4);
        expect(screen.getByText(/Add custom MCP server/)).toBeTruthy();
        expect(screen.getByText("ChatGPT Business, Enterprise and Edu only")).toBeTruthy();
        expect(screen.getByText(/Plus or Pro account you may not have this option/)).toBeTruthy();
        expect(screen.getByRole("link", { name: "ChatGPT's official guide" }).getAttribute("href")).toBe(
            "https://help.openai.com/en/articles/12584461",
        );
        // Picking the open tab again folds it.
        fireEvent.click(screen.getByRole("button", { name: "With ChatGPT" }));
        expect(screen.queryByText(/Add custom MCP server/)).toBeNull();
    });

    it("copies the address, keeps the button's name and announces «Copied» outside it", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        mockList([]);
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Copy address" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(SERVER_URL));
        const status = await waitFor(() => {
            const found = screen.getByRole("status");
            expect(found.textContent).toBe("Copied");
            return found;
        });
        expect(status.className).toContain("sr-only");
        expect(status.closest("button")).toBeNull();
        expect(screen.getByRole("button", { name: "Copy address" }).querySelector("[role]")).toBeNull();
    });

    it("is not shown when the server has connections turned off", async () => {
        vi.mocked(listMcpGrants).mockImplementation(() => Promise.reject(apiError(404)));
        render(<ConnectedAppsSection />);
        await screen.findByText(/does not have connections with AI apps turned on/);
        expect(screen.queryByText("Connect LiTT to Claude or ChatGPT")).toBeNull();
        expect(screen.queryByText(SERVER_URL)).toBeNull();
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
        const table = screen.getByRole("table", { name: "Recent activity of Claude" });
        const rows = within(table).getAllByRole("row").slice(1);
        expect(rows.map((row) => row.textContent)).toEqual([
            expect.stringMatching(/Start a conversationFirm ADone$/),
            expect.stringMatching(/Open a conversationNo workspaceNot allowed$/),
            expect.stringMatching(/See your conversationsPersonalToo many requests$/),
        ]);
        expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["When", "What it did", "Result"]);
        // Never the internal tool name.
        expect(screen.queryByText(/start_chat|get_chat|list_chats/)).toBeNull();
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

describe("ConnectedAppsSection unknown tools", () => {
    it("falls back to the tool's own name when it has no label yet", async () => {
        mockList([grant()]);
        vi.mocked(getMcpGrantActivity).mockResolvedValue({
            calls: [{ tool: "brand_new_tool", at: "2026-11-16T10:00:00.000Z", workspace: null, outcome: "error" }],
            chats: [],
        });
        render(<ConnectedAppsSection />);
        fireEvent.click(await screen.findByRole("button", { name: "Show activity" }));
        expect(await screen.findByText("brand_new_tool")).toBeTruthy();
        expect(screen.getByText("Failed")).toBeTruthy();
    });
});

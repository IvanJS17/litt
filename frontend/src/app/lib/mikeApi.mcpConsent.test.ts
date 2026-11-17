import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideMcpConsent, getMcpConsentRequest, getMcpGrantActivity } from "./mikeApi";

// The consent page's client calls: route, method and body, identifier encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

describe("MCP consent API", () => {
    it("loads the request the app made", async () => {
        await expect(getMcpConsentRequest("r 1")).resolves.toEqual({ ok: true });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/mcp-connect/authorizations/r%201");
        expect(init.method ?? "GET").toBe("GET");
    });

    it.each<[string, Parameters<typeof decideMcpConsent>[1]]>([
        ["deny", { decision: "deny" }],
        ["approve", { decision: "approve", workspaces: ["personal"], scopes: ["a"], default_workspace: "personal" }],
    ])("sends the %s decision as JSON", async (_name, decision) => {
        await decideMcpConsent("r 1", decision);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/mcp-connect/authorizations/r%201/decision");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual(decision);
    });
});

describe("getMcpGrantActivity", () => {
    const answer = (body: unknown, status = 200) =>
        fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));

    it("loads one connection's recent calls and conversations, with the identifier encoded", async () => {
        answer({
            calls: [{ tool: "start_chat", at: "2026-11-16T10:00:00Z", workspace: "personal", outcome: "ok" }],
            chats: [{ id: "c1", title: "Renta", project_id: "p1", workspace: "org-1", created_at: "2026-11-16T10:00:01Z" }],
        });
        await expect(getMcpGrantActivity("g/1")).resolves.toEqual({
            calls: [{ tool: "start_chat", at: "2026-11-16T10:00:00Z", workspace: "personal", outcome: "ok" }],
            chats: [{ id: "c1", title: "Renta", project_id: "p1", workspace: "org-1", created_at: "2026-11-16T10:00:01Z" }],
        });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/mcp-connect/grants/g%2F1/activity");
        expect(init.method ?? "GET").toBe("GET");
    });

    it("fills what is missing with safe defaults", async () => {
        answer({
            calls: [{ tool: "get_chat", at: "2026-11-16T10:00:00Z", outcome: "something-new" }],
            chats: [{ id: "c2", created_at: "2026-11-16T10:00:01Z", title: 4, project_id: 7, workspace: 9 }],
        });
        await expect(getMcpGrantActivity("g1")).resolves.toEqual({
            calls: [{ tool: "get_chat", at: "2026-11-16T10:00:00Z", workspace: null, outcome: "error" }],
            chats: [{ id: "c2", title: null, project_id: null, workspace: "personal", created_at: "2026-11-16T10:00:01Z" }],
        });
    });

    it.each([
        ["an array", []],
        ["null", null],
        ["a string", "nope"],
        ["an object without lists", {}],
        ["lists that are not arrays", { calls: "x", chats: { id: "c" } }],
    ])("reads %s as no activity", async (_name, body) => {
        answer(body);
        await expect(getMcpGrantActivity("g1")).resolves.toEqual({ calls: [], chats: [] });
    });

    it("drops rows that are not the shape promised", async () => {
        answer({
            calls: [null, "x", [], { tool: 5, at: "2026-11-16T10:00:00Z" }, { tool: "t" }, { tool: "t", at: 3 }],
            chats: [null, 1, { id: 1, created_at: "2026-11-16T10:00:00Z" }, { id: "c" }, { id: "c", created_at: 5 }],
        });
        await expect(getMcpGrantActivity("g1")).resolves.toEqual({ calls: [], chats: [] });
    });

    it("lets a refusal through as an API error", async () => {
        answer({ code: "grant_not_found", detail: "Connection not found." }, 404);
        await expect(getMcpGrantActivity("g1")).rejects.toMatchObject({ status: 404 });
    });
});

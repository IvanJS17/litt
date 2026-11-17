import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideMcpConsent, getMcpConsentRequest } from "./mikeApi";

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

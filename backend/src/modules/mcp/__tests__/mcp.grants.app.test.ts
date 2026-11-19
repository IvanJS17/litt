import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../../../lib/supabase";
import { connectedAppOf, listGrantsForUser } from "../mcp.grants";
import { MCP_TOOLS } from "../mcp.catalog";

describe("connectedAppOf", () => {
    it.each([
        ["https://claude.ai/oauth/mcp-oauth-client-metadata", "claude"],
        ["https://anthropic.com/client.json", "claude"],
        ["https://CLAUDE.AI/oauth/x", "claude"],
        ["https://openai.com/chatgpt/mcp-client", "chatgpt"],
        ["https://chatgpt.com/oauth/client", "chatgpt"],
    ])("recognises %s as %s", (clientId, app) => {
        expect(connectedAppOf(clientId)).toBe(app);
    });

    it.each([
        ["a look-alike subdomain", "https://claude.ai.evil.com/oauth/x"],
        ["a look-alike prefix", "https://evilclaude.ai/oauth/x"],
        ["a look-alike suffix", "https://notchatgpt.com/x"],
        ["the brand in the path", "https://evil.com/claude.ai/openai.com"],
        ["the brand in the userinfo", "https://claude.ai@evil.com/x"],
        ["credentials on the real host", "https://user:pw@claude.ai/x"],
        ["a custom port", "https://claude.ai:8443/x"],
        ["plain http", "http://claude.ai/x"],
        ["a registered client id (not a URL)", "5d3f1a52-9d0c-4c75-a4ab-0d9d9a3b6c11"],
        ["a different scheme", "claude://claude.ai/x"],
        ["an empty id", ""],
    ])("gives null for %s", (_label, clientId) => {
        expect(connectedAppOf(clientId)).toBeNull();
    });
});

describe("listGrantsForUser", () => {
    const row = (id: string, client_id: string) => ({
        id,
        user_id: "u1",
        client_id,
        resource: "r",
        scopes: ["litt.read"],
        workspaces: ["personal"],
        default_workspace: "personal",
        mfa_verified_at: null,
        created_at: "2026-11-01T00:00:00.000Z",
        last_used_at: null,
        expires_at: "2999-01-01T00:00:00.000Z",
        revoked_at: null,
    });

    it("derives app from the client id's host, never from the name the client declared", async () => {
        const grants = [
            row("g1", "https://claude.ai/oauth/mcp-oauth-client-metadata"),
            row("g2", "https://claude.ai.evil.com/meta"),
            row("g3", "dyn-client-1"),
        ];
        // The impostors both call themselves "Claude".
        const names = grants.map((g) => ({ client_id: g.client_id, client_name: "Claude" }));
        const db = {
            from: (table: string) => ({
                select: () => ({
                    eq: () => ({ is: () => ({ order: async () => ({ data: grants, error: null }) }) }),
                    in: async () => ({ data: table === "mcp_oauth_clients" ? names : [], error: null }),
                }),
            }),
        } as unknown as Db;
        const listed = await listGrantsForUser(db, "u1");
        expect(listed.map((g) => [g.id, g.client_name, g.app])).toEqual([
            ["g1", "Claude", "claude"],
            ["g2", "Claude", null],
            ["g3", "Claude", null],
        ]);
    });
});

// The labels the connected-apps screen shows instead of internal tool names.
describe("connected-apps tool labels", () => {
    const labels = (locale: string) =>
        (
            JSON.parse(
                readFileSync(join(__dirname, "../../../../../packages/i18n/messages", `${locale}.json`), "utf8"),
            ) as { settings: { connectedApps: { tool: Record<string, string> } } }
        ).settings.connectedApps.tool;

    it.each(["es-MX", "en-US"])("%s has a label for every tool of the MCP catalog", (locale) => {
        const map = labels(locale);
        const missing = MCP_TOOLS.map((tool) => tool.name).filter((name) => !map[name]?.trim());
        expect(missing).toEqual([]);
    });

    it.each(["es-MX", "en-US"])("%s has no label for a tool that does not exist", (locale) => {
        const names = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
        const stale = Object.keys(labels(locale)).filter((name) => !names.has(name));
        expect(stale).toEqual([]);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The background refresh posts a stored secret and refresh token; only the
// network edge is replaced.
const world = vi.hoisted(() => ({
    calls: [] as Array<{ url: string; body: string; maxResponseBytes?: number; hasDeadline: boolean }>,
}));

vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return {
        ...actual,
        guardedFetch: async (
            input: unknown,
            init?: RequestInit,
            options?: { maxResponseBytes?: number },
        ) => {
            world.calls.push({
                url: String(input),
                body: String(init?.body ?? ""),
                maxResponseBytes: options?.maxResponseBytes,
                hasDeadline: !!init?.signal,
            });
            return new Response(
                JSON.stringify({ access_token: "AT-new", token_type: "Bearer", expires_in: 3600 }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        },
    };
});

import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { encryptString } from "./client";
import { McpOAuthRequiredError, refreshOAuthAccessToken } from "./oauth";
import type { Db, OAuthTokenRow } from "./types";

const CONNECTOR = "00000000-0000-4000-8000-0000000000c1";
const SECRET = "operator-secret-refresh";

const seal = (value: string) => {
    const e = encryptString(value);
    return [e.encrypted, e.iv, e.tag] as const;
};

function setup(row: Record<string, unknown>) {
    const [rt, rtIv, rtTag] = seal("RT-1");
    const [cs, csIv, csTag] = seal(SECRET);
    const tables: Record<string, Row[]> = {
        user_mcp_connectors: [{ id: CONNECTOR, auth_type: "oauth" }],
        user_mcp_oauth_tokens: [
            {
                id: "t1",
                connector_id: CONNECTOR,
                encrypted_refresh_token: rt,
                refresh_token_iv: rtIv,
                refresh_token_tag: rtTag,
                encrypted_client_secret: cs,
                client_secret_iv: csIv,
                client_secret_tag: csTag,
                client_id: "operator-client",
                authorization_server: "https://accounts.google.com",
                ...row,
            },
        ],
    };
    const mem = memoryDb(tables);
    const db = {
        from(table: string) {
            const builder = mem.db.from(table) as unknown as Record<string, unknown>;
            builder.upsert = async (r: Row, o: { onConflict: string }) => {
                const existing = tables[table].find((x) => x[o.onConflict] === r[o.onConflict]);
                if (existing) Object.assign(existing, r);
                return { error: null };
            };
            return builder;
        },
    } as unknown as Db;
    return { db, row: tables.user_mcp_oauth_tokens[0] as unknown as OAuthTokenRow };
}

const GOOGLE = "https://drivemcp.googleapis.com/mcp/v1";

beforeEach(() => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-secret-for-refresh";
    process.env.GOOGLE_MCP_OAUTH_CLIENT_ID = "operator-client";
    process.env.GOOGLE_MCP_OAUTH_CLIENT_SECRET = SECRET;
    world.calls = [];
});
afterEach(() => {
    delete process.env.GOOGLE_MCP_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_MCP_OAUTH_CLIENT_SECRET;
});

describe("refreshOAuthAccessToken", () => {
    it("posts nothing to a token endpoint outside the provider's, and asks to reconnect", async () => {
        const { db, row } = setup({ token_endpoint: "https://collector.example/token", resource: GOOGLE });
        const err = await refreshOAuthAccessToken(row, db).catch((e) => e);
        expect(err).toBeInstanceOf(McpOAuthRequiredError);
        expect(err.permanent).toBe(true);
        expect(world.calls).toEqual([]);
    });

    it("refreshes against the provider's own token endpoint", async () => {
        const { db, row } = setup({ token_endpoint: "https://oauth2.googleapis.com/token", resource: GOOGLE });
        await refreshOAuthAccessToken(row, db);
        expect(world.calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token"]);
        expect(world.calls[0].body).toContain("grant_type=refresh_token");
    });

    it("posts nothing for a grant that records no resource", async () => {
        const { db, row } = setup({ token_endpoint: "https://oauth2.googleapis.com/token", resource: null });
        await expect(refreshOAuthAccessToken(row, db)).rejects.toBeInstanceOf(McpOAuthRequiredError);
        expect(world.calls).toEqual([]);
    });

    it("leaves a connector that is not at a provider host as before", async () => {
        const { db, row } = setup({
            token_endpoint: "https://as.example.test/token",
            resource: "https://mcp.example.test/mcp",
        });
        await refreshOAuthAccessToken(row, db);
        expect(world.calls.map((c) => c.url)).toEqual(["https://as.example.test/token"]);
    });

    it("reads the token endpoint's answer under a size cap and a deadline", async () => {
        const { db, row } = setup({ token_endpoint: "https://oauth2.googleapis.com/token", resource: GOOGLE });
        await refreshOAuthAccessToken(row, db);
        expect(world.calls[0].maxResponseBytes).toBeGreaterThan(0);
        expect(world.calls[0].hasDeadline).toBe(true);
    });
});

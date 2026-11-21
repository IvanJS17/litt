import { beforeEach, describe, expect, it, vi } from "vitest";

// A stored credential goes only to the origin it was entered or issued for:
// moving a connector to another server starts it without credentials.
vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return {
        ...actual,
        validateRemoteMcpUrl: async (raw: string) => {
            const url = new URL(raw);
            url.hash = "";
            return url.toString();
        },
    };
});

import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { authConfigPatch, decryptAuthConfig } from "./client";
import { updateUserMcpConnector } from "./servers";
import type { ConnectorRow } from "./types";

const USER = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-0000000000c1";
const ORIGIN = "https://mcp.example.test/mcp";

function setup(authType: "bearer" | "oauth") {
    const tables: Record<string, Row[]> = {
        user_mcp_connectors: [
            {
                id: ID,
                user_id: USER,
                name: "Remote",
                transport: "streamable_http",
                server_url: ORIGIN,
                auth_type: authType,
                enabled: true,
                tool_policy: {},
                ...authConfigPatch({
                    bearerToken: authType === "bearer" ? "stored-bearer" : undefined,
                    headers: { "X-Api-Key": "stored-header" },
                }),
            },
        ],
        user_mcp_connector_tools: [],
        user_mcp_oauth_tokens:
            authType === "oauth"
                ? [{ id: "t1", connector_id: ID, encrypted_access_token: "x" }]
                : [],
    };
    return { db: memoryDb(tables).db, tables };
}

const stored = (tables: Record<string, Row[]>) => {
    const row = tables.user_mcp_connectors[0];
    return { row, config: decryptAuthConfig(row as unknown as ConnectorRow) };
};

describe("changing a connector's server", () => {
    beforeEach(() => {
        process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-secret-for-connector-credentials";
    });

    it("drops the stored bearer token and header values when the origin changes", async () => {
        const { db, tables } = setup("bearer");
        await updateUserMcpConnector(USER, ID, { serverUrl: "https://other.example.test/mcp" }, db);
        const { row, config } = stored(tables);
        expect(row.server_url).toBe("https://other.example.test/mcp");
        expect(config.bearerToken).toBeUndefined();
        expect(config.headers ?? {}).toEqual({});
        expect(row.auth_type).toBe("none");
    });

    it("drops the OAuth grant and its client when the origin changes", async () => {
        const { db, tables } = setup("oauth");
        await updateUserMcpConnector(USER, ID, { serverUrl: "https://mcp.example.test:8443/mcp" }, db);
        const { row, config } = stored(tables);
        expect(tables.user_mcp_oauth_tokens).toHaveLength(0);
        expect(row.auth_type).toBe("none");
        expect(config.headers ?? {}).toEqual({});
    });

    it("keeps only the credentials restated with the new server", async () => {
        const { db, tables } = setup("bearer");
        await updateUserMcpConnector(
            USER,
            ID,
            { serverUrl: "https://other.example.test/mcp", bearerToken: "new-bearer" },
            db,
        );
        const { row, config } = stored(tables);
        expect(config.bearerToken).toBe("new-bearer");
        expect(config.headers ?? {}).toEqual({});
        expect(row.auth_type).toBe("bearer");
    });

    it("keeps the credentials on a rename, on the same URL, or on a path change at the same origin", async () => {
        const bearer = setup("bearer");
        await updateUserMcpConnector(USER, ID, { name: "Renamed", serverUrl: ORIGIN }, bearer.db);
        await updateUserMcpConnector(USER, ID, { serverUrl: "https://mcp.example.test/v2/mcp" }, bearer.db);
        const { row, config } = stored(bearer.tables);
        expect(row.server_url).toBe("https://mcp.example.test/v2/mcp");
        expect(config.bearerToken).toBe("stored-bearer");
        expect(config.headers).toEqual({ "X-Api-Key": "stored-header" });
        expect(row.auth_type).toBe("bearer");

        const oauth = setup("oauth");
        await updateUserMcpConnector(USER, ID, { serverUrl: "https://mcp.example.test/v2/mcp" }, oauth.db);
        expect(oauth.tables.user_mcp_oauth_tokens).toHaveLength(1);
        expect(stored(oauth.tables).row.auth_type).toBe("oauth");
    });
});

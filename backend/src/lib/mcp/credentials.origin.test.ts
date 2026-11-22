import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// A connector's stored credentials (bearer token, header values, OAuth grant)
// are used only for the origin they were entered or issued for. The real MCP
// SDK transport runs against an in-process fake; only the network edge and the
// URL guard (which would resolve DNS) are replaced. Every outgoing request is
// recorded so the tests assert what was actually sent.
type Call = {
    url: string;
    host: string;
    method: string;
    headers: Record<string, string>;
    body: string;
};
const world = vi.hoisted(() => ({
    calls: [] as Array<{
        url: string;
        host: string;
        method: string;
        headers: Record<string, string>;
        body: string;
    }>,
    onCodeExchange: null as null | (() => Promise<void>),
}));

vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return {
        ...actual,
        guardedFetch: async (input: unknown, init?: RequestInit) => {
            const url = new URL(String(input));
            const headers: Record<string, string> = {};
            new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
            const body = init?.body ? String(init.body) : "";
            world.calls.push({
                url: url.toString(),
                host: url.host,
                method: init?.method ?? "GET",
                headers,
                body,
            });
            return respond(url, init?.method ?? "GET", body);
        },
        validateRemoteMcpUrl: async (raw: string) => {
            const url = new URL(raw);
            url.hash = "";
            return url.toString();
        },
    };
});

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

async function respond(url: URL, method: string, body: string): Promise<Response> {
    if (url.host === "as-a.test") {
        if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
            return json({
                issuer: url.origin,
                authorization_endpoint: `${url.origin}/authorize`,
                token_endpoint: `${url.origin}/token`,
                registration_endpoint: `${url.origin}/register`,
                response_types_supported: ["code"],
                grant_types_supported: ["authorization_code", "refresh_token"],
                code_challenge_methods_supported: ["S256"],
            });
        }
        if (url.pathname === "/register") {
            return json(
                {
                    ...JSON.parse(body),
                    client_id: "client-as-a",
                    client_secret: "client-secret-as-a",
                },
                201,
            );
        }
        if (url.pathname === "/token") {
            const params = new URLSearchParams(body);
            if (params.get("grant_type") === "authorization_code") {
                await world.onCodeExchange?.();
            }
            return json({
                access_token: "AT-as-a",
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: "RT-as-a",
            });
        }
        return new Response("not found", { status: 404 });
    }
    // MCP servers
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return url.host === "mcp.example.test"
            ? json({
                  resource: "https://mcp.example.test/mcp",
                  authorization_servers: ["https://as-a.test"],
              })
            : new Response("none", { status: 404 });
    }
    if (url.pathname.startsWith("/.well-known/")) {
        return new Response("none", { status: 404 });
    }
    if (method === "GET") return new Response("", { status: 405 });
    if (method === "DELETE") return new Response("", { status: 200 });
    const message = JSON.parse(body || "{}");
    if (message.id === undefined) return new Response("", { status: 202 });
    if (message.method === "initialize") {
        return json({
            jsonrpc: "2.0",
            id: message.id,
            result: {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: "fake", version: "1" },
            },
        });
    }
    return json({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
}

import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import {
    authConfigPatch,
    decryptAuthConfig,
    encryptString,
    mcpConnectionFingerprint,
    toConnectorSummary,
} from "./client";
import { DbMcpOAuthProvider, startUserMcpConnectorOAuth } from "./oauth";
import {
    completeUserMcpConnectorOAuth,
    createUserMcpConnector,
    refreshUserMcpConnectorTools,
    updateUserMcpConnector,
} from "./servers";
import type { ConnectorRow, Db } from "./types";

const USER = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-0000000000c1";
const OLD_URL = "https://mcp.example.test/mcp";
const OLD_ORIGIN = "https://mcp.example.test";
const NEW_URL = "https://collector.example.test/mcp";
const NEW_ORIGIN = "https://collector.example.test";
const REDIRECT = "https://app.mike.test/api/user/mcp-connectors/oauth/callback";
const SECRETS = ["stored-bearer", "stored-header", "stored-bearer-2", "AT-as-a", "RT-as-a", "AT-old", "RT-old"];

let tables: Record<string, Row[]>;
let mem: ReturnType<typeof memoryDb>;
let db: Db;
let before: ((table: string, op: string) => Promise<void>) | undefined;

function setup(
    overrides: Record<string, unknown> = {},
    config: Parameters<typeof authConfigPatch>[0] = {
        bearerToken: "stored-bearer",
        headers: { "X-Api-Key": "stored-header" },
        origin: OLD_ORIGIN,
    },
) {
    tables = {
        user_mcp_connectors: [
            {
                id: ID,
                user_id: USER,
                name: "Remote",
                transport: "streamable_http",
                server_url: OLD_URL,
                auth_type: "bearer",
                enabled: true,
                tool_policy: {},
                ...authConfigPatch(config),
                ...overrides,
            },
        ],
        user_mcp_oauth_tokens: [],
        user_mcp_oauth_states: [],
        user_mcp_connector_tools: [],
    };
    mem = memoryDb(tables);
    before = undefined;
    // The in-memory database plus upsert, and a hook that can hold an
    // operation back so two requests interleave deterministically.
    db = {
        from(table: string) {
            const b = mem.db.from(table) as unknown as Record<string, any>;
            let op = "select";
            for (const o of ["update", "delete", "insert"]) {
                const f = b[o];
                b[o] = (...a: unknown[]) => {
                    op = o;
                    return f(...a);
                };
            }
            for (const t of ["single", "maybeSingle"]) {
                const f = b[t];
                b[t] = () => Promise.resolve(before?.(table, op)).then(() => f());
            }
            const then = b.then;
            b.then = (res: any, rej: any) =>
                Promise.resolve(before?.(table, op)).then(() => then(res, rej), rej);
            b.upsert = async (row: Row, options: { onConflict: string }) => {
                const rows = tables[table];
                const existing = rows.find(
                    (r) => r[options.onConflict] === row[options.onConflict],
                );
                if (existing) Object.assign(existing, row);
                else rows.push({ id: randomUUID(), ...row });
                return { error: null };
            };
            return b;
        },
    } as unknown as Db;
}

const connector = () => tables.user_mcp_connectors[0] as unknown as ConnectorRow;
const sentTo = (host: string): Call[] => world.calls.filter((c) => c.host === host);
const carried = (calls: Call[]) =>
    SECRETS.filter((secret) =>
        calls.some((c) => JSON.stringify(c.headers).includes(secret) || c.body.includes(secret)),
    );

beforeEach(() => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-secret-for-connector-origin";
    world.calls = [];
    world.onCodeExchange = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("credentials are used only for the origin they were entered for", () => {
    it("sends a bearer token and header values to the origin they were entered for", async () => {
        setup();
        await refreshUserMcpConnectorTools(USER, ID, db);
        const first = sentTo("mcp.example.test")[0];
        expect(first.headers.authorization).toBe("Bearer stored-bearer");
        expect(first.headers["x-api-key"]).toBe("stored-header");
    });

    it("keeps working for a connector saved before origins were recorded", async () => {
        setup({}, { bearerToken: "stored-bearer", headers: { "X-Api-Key": "stored-header" } });
        await refreshUserMcpConnectorTools(USER, ID, db);
        expect(sentTo("mcp.example.test")[0].headers.authorization).toBe("Bearer stored-bearer");
    });

    it("sends nothing stored when the server URL is on another origin than the credentials", async () => {
        // The shape left behind when a URL change did not clear the credentials.
        setup({ server_url: NEW_URL });
        await refreshUserMcpConnectorTools(USER, ID, db);
        const calls = sentTo("collector.example.test");
        expect(calls.length).toBeGreaterThan(0);
        expect(carried(calls)).toEqual([]);
        expect(calls[0].headers.authorization).toBeUndefined();
        expect(calls[0].headers["x-api-key"]).toBeUndefined();
    });

    it("reports a connector whose credentials belong to another origin as having none", async () => {
        setup({ server_url: NEW_URL });
        const summary = await refreshUserMcpConnectorTools(USER, ID, db);
        expect(summary.hasAuthConfig).toBe(false);
        expect(summary.customHeaderKeys).toEqual([]);
    });

    it("stamps the origin of the row it read when a credential is edited", async () => {
        setup({}, { bearerToken: "stored-bearer", headers: { "X-Api-Key": "stored-header" } });
        await updateUserMcpConnector(USER, ID, { bearerToken: "stored-bearer-2" }, db);
        expect(decryptAuthConfig(connector())).toMatchObject({
            bearerToken: "stored-bearer-2",
            origin: OLD_ORIGIN,
        });
    });

    it("stamps the origin on a connector created with credentials", async () => {
        setup();
        tables.user_mcp_connectors.length = 0;
        await createUserMcpConnector(
            { userId: USER, orgId: null },
            { name: "New", serverUrl: NEW_URL, bearerToken: "stored-bearer-2" },
            db,
        );
        expect(decryptAuthConfig(connector())).toMatchObject({
            bearerToken: "stored-bearer-2",
            origin: NEW_ORIGIN,
        });
    });

    it("stamps credentials entered together with a new server URL with the new origin", async () => {
        setup();
        await updateUserMcpConnector(
            USER,
            ID,
            { serverUrl: NEW_URL, bearerToken: "stored-bearer-2" },
            db,
        );
        expect(decryptAuthConfig(connector())).toMatchObject({ origin: NEW_ORIGIN });
        await refreshUserMcpConnectorTools(USER, ID, db);
        expect(sentTo("collector.example.test")[0].headers.authorization).toBe(
            "Bearer stored-bearer-2",
        );
    });
});

describe("a failed read of the connector", () => {
    it("fails a request that changes the server URL and leaves the connector as it was", async () => {
        setup();
        mem.failNext("user_mcp_connectors", "select", { message: "transient read failure" });
        await expect(
            updateUserMcpConnector(USER, ID, { serverUrl: NEW_URL }, db),
        ).rejects.toMatchObject({ message: "transient read failure" });
        expect(connector().server_url).toBe(OLD_URL);
        expect(decryptAuthConfig(connector()).bearerToken).toBe("stored-bearer");
    });
});

describe("two requests that interleave", () => {
    it.each([
        ["recorded for the old origin", { origin: OLD_ORIGIN }],
        ["saved before origins were recorded", {}],
    ])("does not send a credential edit read before an origin change to the new origin (credentials %s)", async (_label, stamp) => {
        setup({}, { bearerToken: "stored-bearer", headers: { "X-Api-Key": "stored-header" }, ...stamp });
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => (release = r));
        let held = false;
        before = async (table, op) => {
            if (table === "user_mcp_connectors" && op === "update" && !held) {
                held = true;
                await gate;
            }
        };
        // The edit read the old URL; the origin change lands before it writes.
        const edit = updateUserMcpConnector(USER, ID, { bearerToken: "stored-bearer-2" }, db);
        await new Promise((r) => setTimeout(r, 20));
        await updateUserMcpConnector(USER, ID, { serverUrl: NEW_URL }, db);
        release();
        await edit;
        before = undefined;

        expect(connector().server_url).toBe(NEW_URL);
        world.calls = [];
        await refreshUserMcpConnectorTools(USER, ID, db);
        const calls = sentTo("collector.example.test");
        expect(calls.length).toBeGreaterThan(0);
        expect(carried(calls)).toEqual([]);
        expect(calls.every((c) => !c.headers.authorization && !c.headers["x-api-key"])).toBe(true);
    });

    it("does not send header values rewritten by an OAuth completion that began before an origin change", async () => {
        setup(
            { auth_type: "none" },
            { headers: { "X-Api-Key": "stored-header" }, origin: OLD_ORIGIN },
        );
        const started = await startUserMcpConnectorOAuth(USER, ID, REDIRECT, db);
        const state = new URL(started.authorizationUrl!).searchParams.get("state")!;
        world.onCodeExchange = async () => {
            world.onCodeExchange = null;
            await updateUserMcpConnector(USER, ID, { serverUrl: NEW_URL }, db);
        };
        world.calls = [];

        await completeUserMcpConnectorOAuth(USER, state, "code-1", db).catch(() => undefined);
        await refreshUserMcpConnectorTools(USER, ID, db).catch(() => undefined);

        expect(connector().server_url).toBe(NEW_URL);
        const calls = sentTo("collector.example.test");
        expect(calls.length).toBeGreaterThan(0);
        expect(carried(calls)).toEqual([]);
        expect(calls.every((c) => !c.headers.authorization && !c.headers["x-api-key"])).toBe(true);
    });
});

describe("a stored OAuth grant is used only for the origin it was issued for", () => {
    function grant(resource: string | null) {
        const at = encryptString("AT-old");
        const rt = encryptString("RT-old");
        tables.user_mcp_oauth_tokens.push({
            id: randomUUID(),
            connector_id: ID,
            encrypted_access_token: at.encrypted,
            access_token_iv: at.iv,
            access_token_tag: at.tag,
            encrypted_refresh_token: rt.encrypted,
            refresh_token_iv: rt.iv,
            refresh_token_tag: rt.tag,
            token_type: "Bearer",
            authorization_server: "https://as-a.test",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            ...(resource ? { resource } : {}),
        });
    }

    it("presents the access token to the server it was issued for", async () => {
        setup({ auth_type: "oauth" }, {});
        grant(OLD_URL);
        await refreshUserMcpConnectorTools(USER, ID, db);
        expect(sentTo("mcp.example.test")[0].headers.authorization).toBe("Bearer AT-old");
    });

    it("does not present a grant issued for another origin", async () => {
        setup({ auth_type: "oauth", server_url: NEW_URL }, {});
        grant(OLD_URL);
        await refreshUserMcpConnectorTools(USER, ID, db).catch(() => undefined);
        expect(carried(world.calls)).toEqual([]);
    });

    it("does not present a grant that records no server (the person reconnects)", async () => {
        setup({ auth_type: "oauth", server_url: NEW_URL }, {});
        grant(null);
        await refreshUserMcpConnectorTools(USER, ID, db).catch(() => undefined);
        expect(carried(world.calls)).toEqual([]);
    });
});


// A row whose stored credentials were entered for another origin than the
// one it now points at (a stale write landed after the server moved).
describe("credentials entered for another origin are never carried forward", () => {
    const stale = () => setup({ server_url: NEW_URL });

    it("starts from nothing when a header is edited, rather than re-stamping the old bearer and headers", async () => {
        stale();
        await updateUserMcpConnector(USER, ID, { headers: { "X-New": "new-header" } }, db);
        const config = decryptAuthConfig(connector());
        expect(config.bearerToken).toBeUndefined();
        expect(config.headers).toEqual({ "X-New": "new-header" });
        expect(config.origin).toBe(NEW_ORIGIN);
        expect(connector().auth_type).toBe("none");
    });

    it("does not write the old header values back, stamped for the new origin, when an OAuth sign-in completes", async () => {
        stale();
        await new DbMcpOAuthProvider(db, connector(), USER, "use", REDIRECT).saveTokens({
            access_token: "AT-new",
            token_type: "Bearer",
        });
        const config = decryptAuthConfig(connector());
        expect(config.headers ?? {}).toEqual({});
        expect(config.bearerToken).toBeUndefined();
        expect(JSON.stringify(config)).not.toContain("stored-header");
    });

    it("leaves credentials that do not fit the origin out of the connection fingerprint", async () => {
        stale();
        const otherStale = {
            ...connector(),
            ...authConfigPatch({ bearerToken: "another-bearer", origin: OLD_ORIGIN }),
        } as ConnectorRow;
        expect(await mcpConnectionFingerprint(connector(), null)).toBe(
            await mcpConnectionFingerprint(otherStale, null),
        );
        const fitting = { ...connector(), server_url: OLD_URL } as ConnectorRow;
        const otherFitting = {
            ...fitting,
            ...authConfigPatch({ bearerToken: "another-bearer", origin: OLD_ORIGIN }),
        } as ConnectorRow;
        expect(await mcpConnectionFingerprint(fitting, null)).not.toBe(
            await mcpConnectionFingerprint(otherFitting, null),
        );
    });
});

describe("the connector summary follows the credentials that will be used", () => {
    const grantFor = (resource: string | null) =>
        ({ encrypted_access_token: "x", resource }) as never;

    it("shows a bearer connector whose credentials fit another origin as having none", () => {
        setup({ server_url: NEW_URL });
        expect(toConnectorSummary(connector(), [])).toMatchObject({
            authType: "none",
            hasAuthConfig: false,
            customHeaderKeys: [],
        });
    });

    it("keeps a bearer connector whose credentials fit its origin as it is", () => {
        setup();
        expect(toConnectorSummary(connector(), [])).toMatchObject({
            authType: "bearer",
            hasAuthConfig: true,
        });
    });

    it("shows a sign-in issued for another origin as not connected", () => {
        setup({ auth_type: "oauth", server_url: NEW_URL }, {});
        expect(toConnectorSummary(connector(), [], grantFor(OLD_URL))).toMatchObject({
            authType: "oauth",
            oauthConnected: false,
        });
    });

    it("shows a sign-in that records no server as not connected, and one for this origin as connected", () => {
        setup({ auth_type: "oauth" }, {});
        expect(toConnectorSummary(connector(), [], grantFor(null)).oauthConnected).toBe(false);
        expect(toConnectorSummary(connector(), [], grantFor(OLD_URL)).oauthConnected).toBe(true);
        expect(toConnectorSummary(connector(), []).oauthConnected).toBe(false);
    });
});

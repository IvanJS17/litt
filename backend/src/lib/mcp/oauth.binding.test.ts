import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { auth as runMcpOAuth } from "@modelcontextprotocol/sdk/client/auth.js";

// The real MCP SDK runs against an in-process fake of a remote MCP server and
// of its authorization servers. Only the network edge (guardedFetch) and the
// URL guard (which would resolve DNS) are replaced.
type Call = { url: string; method: string; body: string };
const world = vi.hoisted(() => ({
    calls: [] as Array<{ url: string; method: string; body: string }>,
    route: null as null | ((input: unknown, init?: RequestInit) => Response),
}));

vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return {
        ...actual,
        guardedFetch: async (input: unknown, init?: RequestInit) => {
            world.calls.push({
                url: String(input),
                method: init?.method ?? "GET",
                // Client credentials travel in the body or as Basic auth.
                body: [
                    init?.body ? String(init.body) : "",
                    Buffer.from(
                        (new Headers(init?.headers).get("authorization") ?? "")
                            .replace(/^Basic /, ""),
                        "base64",
                    ).toString("utf8"),
                ].join("\n"),
            });
            return world.route!(input, init);
        },
        validateRemoteMcpUrl: async (raw: string) => {
            const url = new URL(raw);
            url.hash = "";
            return url.toString();
        },
    };
});

import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { authConfigPatch, encryptString, guardedFetch } from "./client";
import {
    completeMcpConnectorOAuthAuthorization,
    DbMcpOAuthProvider,
    McpOAuthRequiredError,
    startUserMcpConnectorOAuth,
} from "./oauth";
import type { ConnectorRow, Db } from "./types";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const CONNECTOR = "00000000-0000-4000-8000-0000000000c1";
const REDIRECT = "https://app.mike.test/api/user/mcp-connectors/oauth/callback";
const AS_A = "https://as-a.test";
const AS_B = "https://as-b.test";

const fake = {
    mcpUrl: "https://mcp.example.test/mcp",
    resource: "https://mcp.example.test/mcp",
    authServer: AS_A,
    // Authorization servers that issue a registration (the others are
    // pre-configured: no registration endpoint).
    dcr: true,
    // Host of the token endpoint, when it is not the server's own.
    tokenHost: null as string | null,
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

function route(input: unknown, init?: RequestInit): Response {
    const url = new URL(String(input));
    const mcp = new URL(fake.mcpUrl);
    if (url.host === mcp.host) {
        if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
            return json({
                resource: fake.resource,
                authorization_servers: [fake.authServer],
            });
        }
        return new Response("", {
            status: 401,
            headers: {
                "www-authenticate": `Bearer resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource${mcp.pathname}"`,
            },
        });
    }
    const origin = url.origin;
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
        return json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${fake.tokenHost ? `https://${fake.tokenHost}` : origin}/token`,
            ...(fake.dcr ? { registration_endpoint: `${origin}/register` } : {}),
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
        });
    }
    const name = url.hostname.split(".")[0];
    if (url.pathname === "/register") {
        return json(
            {
                ...JSON.parse(String(init?.body)),
                client_id: `client-${name}`,
                client_secret: `client-secret-${name}`,
            },
            201,
        );
    }
    if (url.pathname === "/token") {
        const params = new URLSearchParams(String(init?.body));
        return json({
            access_token: `AT-${name}-${world.calls.length}`,
            token_type: "Bearer",
            expires_in: 3600,
            ...(params.get("grant_type") === "authorization_code"
                ? { refresh_token: `RT-${name}` }
                : {}),
        });
    }
    return new Response("not found", { status: 404 });
}

function tokenCalls(host: string): Call[] {
    return world.calls.filter(
        (c) => new URL(c.url).host === host && c.url.endsWith("/token"),
    );
}
function sentTo(host: string): string {
    return world.calls
        .filter((c) => new URL(c.url).host === host)
        .map((c) => c.body)
        .join("\n");
}

function setup(serverUrl = fake.mcpUrl) {
    const tables: Record<string, Row[]> = {
        user_mcp_connectors: [
            {
                id: CONNECTOR,
                user_id: OWNER,
                name: "Remote",
                transport: "streamable_http",
                server_url: serverUrl,
                auth_type: "none",
                enabled: true,
                tool_policy: {},
                ...authConfigPatch({}),
            },
        ],
        user_mcp_oauth_tokens: [],
        user_mcp_oauth_states: [],
    };
    const mem = memoryDb(tables);
    const db = {
        from(table: string) {
            const builder = mem.db.from(table) as unknown as Record<string, unknown>;
            builder.upsert = async (
                row: Row,
                options: { onConflict: string },
            ) => {
                const rows = tables[table];
                const existing = rows.find(
                    (r) => r[options.onConflict] === row[options.onConflict],
                );
                if (existing) Object.assign(existing, row);
                else rows.push({ id: randomUUID(), ...row });
                return { error: null };
            };
            return builder;
        },
    } as unknown as Db;
    return { db, tables };
}

const complete = (
    userId: string,
    state: string,
    code: string,
    db: Db,
) => completeMcpConnectorOAuthAuthorization(userId, state, code, db);

const connectorRow = (tables: Record<string, Row[]>) =>
    tables.user_mcp_connectors[0] as unknown as ConnectorRow;
const tokenRow = (tables: Record<string, Row[]>) => tables.user_mcp_oauth_tokens[0];

async function connect(db: Db, userId = OWNER) {
    const started = await startUserMcpConnectorOAuth(userId, CONNECTOR, REDIRECT, db);
    const authorizationUrl = new URL(started.authorizationUrl!);
    const state = authorizationUrl.searchParams.get("state")!;
    return { authorizationUrl, state };
}

async function useAuth(db: Db, tables: Record<string, Row[]>) {
    const provider = new DbMcpOAuthProvider(
        db,
        connectorRow(tables),
        OWNER,
        "use",
        REDIRECT,
    );
    return runMcpOAuth(provider, {
        serverUrl: connectorRow(tables).server_url,
        fetchFn: guardedFetch,
    });
}

beforeEach(() => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-secret-for-connector-binding";
    world.calls = [];
    world.route = route;
    Object.assign(fake, {
        mcpUrl: "https://mcp.example.test/mcp",
        resource: "https://mcp.example.test/mcp",
        authServer: AS_A,
        tokenHost: null,
        dcr: true,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MCP_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_MCP_OAUTH_CLIENT_SECRET;
});

describe("connector OAuth completion", () => {
    it("connects a dynamically registered server and refreshes at the same authorization server", async () => {
        const { db, tables } = setup();
        const { authorizationUrl, state } = await connect(db);
        expect(authorizationUrl.origin).toBe(AS_A);
        expect(authorizationUrl.searchParams.get("resource")).toBe(fake.mcpUrl);

        await complete(OWNER, state, "code-1", db);
        expect(tokenRow(tables).encrypted_refresh_token).toBeTruthy();
        expect(tables.user_mcp_oauth_states).toHaveLength(0);

        world.calls = [];
        expect(await useAuth(db, tables)).toBe("AUTHORIZED");
        expect(sentTo("as-a.test")).toContain("grant_type=refresh_token");
        expect(sentTo("as-a.test")).toContain("RT-as-a");
    });

    it("records which authorization server issued the client and the tokens", async () => {
        const { db, tables } = setup();
        const { state } = await connect(db);
        await complete(OWNER, state, "code-1", db);
        expect(tokenRow(tables).authorization_server).toBe(AS_A);
    });

    it("completes only for the person who started the flow", async () => {
        const { db, tables } = setup();
        const { state } = await connect(db);
        world.calls = [];

        await expect(
            complete(OTHER, state, "code-1", db),
        ).rejects.toThrow(/invalid or expired/);
        expect(tokenCalls("as-a.test")).toHaveLength(0);
        expect(tables.user_mcp_oauth_states).toHaveLength(1);
        expect(tokenRow(tables)?.encrypted_access_token ?? null).toBeNull();

        await complete(OWNER, state, "code-1", db);
        expect(tokenRow(tables).encrypted_access_token).toBeTruthy();
    });
});

describe("stored OAuth grants are bound to the authorization server that issued them", () => {
    async function authorized() {
        const world = setup();
        const { state } = await connect(world.db);
        await complete(OWNER, state, "code-1", world.db);
        return world;
    }

    it("asks to reconnect instead of presenting the grant to a different authorization server", async () => {
        const { db, tables } = await authorized();
        fake.authServer = AS_B;
        world.calls = [];

        await expect(useAuth(db, tables)).rejects.toBeInstanceOf(McpOAuthRequiredError);
        const sent = sentTo("as-b.test");
        expect(sent).not.toContain("RT-as-a");
        expect(sent).not.toContain("client-as-a");
        expect(sent).not.toContain("client-secret-as-a");
    });

    it("does not reuse a grant whose authorization server was never recorded", async () => {
        const { db, tables } = setup();
        const secret = (value: string) => {
            const e = encryptString(value);
            return [e.encrypted, e.iv, e.tag] as const;
        };
        const [at, atIv, atTag] = secret("AT-legacy");
        const [rt, rtIv, rtTag] = secret("RT-legacy");
        const [cs, csIv, csTag] = secret("client-secret-legacy");
        tables.user_mcp_oauth_tokens.push({
            id: randomUUID(),
            connector_id: CONNECTOR,
            encrypted_access_token: at,
            access_token_iv: atIv,
            access_token_tag: atTag,
            encrypted_refresh_token: rt,
            refresh_token_iv: rtIv,
            refresh_token_tag: rtTag,
            client_id: "client-legacy",
            encrypted_client_secret: cs,
            client_secret_iv: csIv,
            client_secret_tag: csTag,
            authorization_server: null,
            // Written after servers were bound to origins, before issuers
            // were recorded: the access token is not handed out with a
            // refresh token it could not be bound with.
            resource: fake.mcpUrl,
            expires_at: new Date(Date.now() - 1000).toISOString(),
        });

        const provider = new DbMcpOAuthProvider(
            db,
            connectorRow(tables),
            OWNER,
            "use",
            REDIRECT,
        );
        const handedOut = await provider.tokens();
        expect(handedOut?.access_token).toBe("AT-legacy");
        expect(handedOut?.refresh_token).toBeUndefined();
        expect(handedOut?.issuer).toBeUndefined();
        await expect(useAuth(db, tables)).rejects.toBeInstanceOf(McpOAuthRequiredError);
        for (const call of world.calls) {
            expect(call.body).not.toContain("RT-legacy");
            expect(call.body).not.toContain("client-secret-legacy");
        }
        expect(tokenCalls("as-a.test")).toHaveLength(0);

        // The person can reconnect: a fresh registration replaces the old grant.
        const { state } = await connect(db);
        await complete(OWNER, state, "code-1", db);
        expect(tokenRow(tables).authorization_server).toBe(AS_A);
        expect(tokenRow(tables).client_id).toBe("client-as-a");
    });
});

describe("protected-resource metadata must describe the connector's own server", () => {
    it.each([
        ["another origin", "https://honest.example/mcp"],
        ["another path on the same origin", "https://mcp.example.test/other"],
    ])("refuses to start when the metadata names %s", async (_label, resource) => {
        const { db } = setup();
        fake.resource = resource;
        await expect(
            startUserMcpConnectorOAuth(OWNER, CONNECTOR, REDIRECT, db),
        ).rejects.toThrow(/does not match the MCP server URL/);
        expect(world.calls.some((c) => c.url.endsWith("/register"))).toBe(false);
        expect(world.calls.some((c) => c.url.endsWith("/authorize"))).toBe(false);
    });

    it("accepts an origin-equal path prefix and requests that resource", async () => {
        const { db } = setup();
        fake.resource = "https://mcp.example.test";
        const { authorizationUrl } = await connect(db);
        expect(authorizationUrl.searchParams.get("resource")).toBe(
            "https://mcp.example.test/",
        );
    });

    it("refuses the code exchange when the metadata changed to another resource", async () => {
        const { db, tables } = setup();
        const { state } = await connect(db);
        fake.resource = "https://honest.example/mcp";
        world.calls = [];
        await expect(
            complete(OWNER, state, "code-1", db),
        ).rejects.toThrow(/does not match the MCP server URL/);
        expect(tokenCalls("as-a.test")).toHaveLength(0);
        expect(tokenRow(tables)?.encrypted_access_token ?? null).toBeNull();
    });
});

describe("the operator's provider client", () => {
    const GOOGLE_MCP = "https://drivemcp.googleapis.com/mcp/v1";
    beforeEach(() => {
        process.env.GOOGLE_MCP_OAUTH_CLIENT_ID = "operator-client.example";
        process.env.GOOGLE_MCP_OAUTH_CLIENT_SECRET = "operator-secret";
        fake.mcpUrl = GOOGLE_MCP;
        fake.resource = GOOGLE_MCP;
        fake.authServer = "https://accounts.google.com";
        fake.tokenHost = "oauth2.googleapis.com";
        fake.dcr = false;
    });

    it("connects and refreshes with the operator's client without storing its secret per person", async () => {
        const { db, tables } = setup(GOOGLE_MCP);
        const { state } = await connect(db);
        await complete(OWNER, state, "code-1", db);
        expect(sentTo("oauth2.googleapis.com")).toContain("operator-secret");

        const row = tokenRow(tables);
        expect(row.client_id ?? null).toBeNull();
        expect(row.encrypted_client_secret ?? null).toBeNull();
        expect(JSON.stringify(row)).not.toContain("operator-secret");

        world.calls = [];
        expect(await useAuth(db, tables)).toBe("AUTHORIZED");
        expect(sentTo("oauth2.googleapis.com")).toContain("operator-secret");
    });

    it("never sends the operator's secret to an authorization server of another party", async () => {
        const { db } = setup("https://bucket.storage.googleapis.com/mcp");
        fake.mcpUrl = "https://bucket.storage.googleapis.com/mcp";
        fake.resource = fake.mcpUrl;
        fake.authServer = "https://evil.example";
        fake.dcr = true;
        await expect(
            startUserMcpConnectorOAuth(OWNER, CONNECTOR, REDIRECT, db),
        ).rejects.toThrow(/not the one this provider's OAuth client was issued for/);
        expect(world.calls.some((c) => c.url.includes("evil.example"))).toBe(true);
        for (const call of world.calls) {
            if (new URL(call.url).host === "evil.example") {
                expect(call.body).not.toContain("operator-secret");
                expect(call.body).not.toContain("operator-client.example");
            }
        }
        expect(world.calls.some((c) => c.url.startsWith("https://evil.example/authorize"))).toBe(false);
    });

    it("ignores a stored copy of the operator's client once the connector is not at a provider host", async () => {
        const { db, tables } = setup("https://mcp.example.test/mcp");
        fake.mcpUrl = "https://mcp.example.test/mcp";
        fake.resource = fake.mcpUrl;
        fake.authServer = AS_A;
        const e = encryptString("operator-secret");
        tables.user_mcp_oauth_tokens.push({
            id: randomUUID(),
            connector_id: CONNECTOR,
            client_id: "operator-client.example",
            encrypted_client_secret: e.encrypted,
            client_secret_iv: e.iv,
            client_secret_tag: e.tag,
            // How every row written before servers were recorded looks.
            authorization_server: null,
        });
        const provider = new DbMcpOAuthProvider(
            db,
            connectorRow(tables),
            OWNER,
            "use",
            REDIRECT,
        );
        const info = await provider.clientInformation();
        expect(JSON.stringify(info ?? {})).not.toContain("operator-secret");
        expect(info?.client_id).not.toBe("operator-client.example");
    });
});

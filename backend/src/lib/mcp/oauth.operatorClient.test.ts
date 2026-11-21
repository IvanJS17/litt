import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { auth as runMcpOAuth } from "@modelcontextprotocol/sdk/client/auth.js";

// The operator's pre-configured client against the metadata documents the
// providers publish. The real MCP SDK runs; only the network edge and the URL
// guard (which would resolve DNS) are replaced.
type Call = { url: string; method: string; sent: string };
const world = vi.hoisted(() => ({
    calls: [] as Array<{ url: string; method: string; sent: string }>,
    documents: {} as Record<string, unknown>,
    // `origin + path` of a GET that answers with a redirect -> its target.
    redirects: {} as Record<string, string>,
}));

vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return {
        ...actual,
        guardedFetch: async (input: unknown, init?: RequestInit) => {
            let url = new URL(String(input));
            // Like the real client: a bodyless request follows redirects.
            for (let hop = 0; hop < 3; hop++) {
                const target = world.redirects[`${url.origin}${url.pathname}`];
                if (!target || (init?.method ?? "GET") !== "GET") break;
                world.calls.push({ url: url.toString(), method: "GET", sent: "" });
                url = new URL(target);
            }
            const basic = (new Headers(init?.headers).get("authorization") ?? "").replace(
                /^Basic /,
                "",
            );
            world.calls.push({
                url: url.toString(),
                method: init?.method ?? "GET",
                // Client credentials travel in the body or as Basic auth.
                sent: [
                    init?.body ? String(init.body) : "",
                    Buffer.from(basic, "base64").toString("utf8"),
                ].join("\n"),
            });
            if (url.pathname.endsWith("/token") || url.pathname.includes("oauth.v2.user.access")) {
                const params = new URLSearchParams(String(init?.body));
                return json({
                    access_token: "AT-1",
                    token_type: "Bearer",
                    expires_in: 3600,
                    ...(params.get("grant_type") === "authorization_code"
                        ? { refresh_token: "RT-1" }
                        : {}),
                });
            }
            const key = `${url.origin}${url.pathname}`;
            const doc = world.documents[key];
            if (doc) return json(doc);
            return new Response("", { status: 401, headers: unauthorized });
        },
        validateRemoteMcpUrl: async (raw: string) => {
            const url = new URL(raw);
            url.hash = "";
            return url.toString();
        },
    };
});

const unauthorized = { "www-authenticate": "Bearer" };
function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { authConfigPatch, guardedFetch } from "./client";
import {
    completeMcpConnectorOAuthAuthorization,
    DbMcpOAuthProvider,
    startUserMcpConnectorOAuth,
} from "./oauth";
import type { ConnectorRow, Db } from "./types";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CONNECTOR = "00000000-0000-4000-8000-0000000000c1";
const REDIRECT = "https://app.mike.test/api/user/mcp-connectors/oauth/callback";

// The documents below are the ones the providers publish: the fields that
// matter here with their exact values, plus `response_types_supported`, which
// the SDK's metadata schema requires.
const providers = [
    {
        name: "Slack",
        prefix: "SLACK_MCP_OAUTH",
        mcpUrl: "https://mcp.slack.com/mcp",
        documents: {
            "https://mcp.slack.com/.well-known/oauth-protected-resource/mcp": {
                resource: "https://mcp.slack.com",
                authorization_servers: ["https://mcp.slack.com"],
            },
            "https://mcp.slack.com/.well-known/oauth-authorization-server": {
                issuer: "https://mcp.slack.com",
                authorization_endpoint: "https://slack.com/oauth/v2_user/authorize",
                token_endpoint: "https://slack.com/api/oauth.v2.user.access",
                response_types_supported: ["code"],
            },
        },
        authorizeEndpoint: "https://slack.com/oauth/v2_user/authorize",
        tokenEndpoint: "https://slack.com/api/oauth.v2.user.access",
        advertisedServer: "https://mcp.slack.com",
    },
    {
        name: "Google",
        prefix: "GOOGLE_MCP_OAUTH",
        mcpUrl: "https://drivemcp.googleapis.com/mcp/v1",
        documents: {
            "https://drivemcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1": {
                resource: "https://drivemcp.googleapis.com/mcp/v1",
                // With a trailing slash; the issuer below has none.
                authorization_servers: ["https://accounts.google.com/"],
            },
            "https://accounts.google.com/.well-known/oauth-authorization-server": {
                issuer: "https://accounts.google.com",
                authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
                token_endpoint: "https://oauth2.googleapis.com/token",
                revocation_endpoint: "https://oauth2.googleapis.com/revoke",
                response_types_supported: ["code"],
            },
        },
        authorizeEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenEndpoint: "https://oauth2.googleapis.com/token",
        advertisedServer: "https://accounts.google.com/",
    },
];

let tables: Record<string, Row[]>;
let db: Db;

function setup(serverUrl: string) {
    tables = {
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
    db = {
        from(table: string) {
            const builder = mem.db.from(table) as unknown as Record<string, unknown>;
            builder.upsert = async (row: Row, options: { onConflict: string }) => {
                const existing = tables[table].find(
                    (r) => r[options.onConflict] === row[options.onConflict],
                );
                if (existing) Object.assign(existing, row);
                else tables[table].push({ id: randomUUID(), ...row });
                return { error: null };
            };
            return builder;
        },
    } as unknown as Db;
}

const callsWith = (secret: string): Call[] => world.calls.filter((c) => c.sent.includes(secret));

beforeEach(() => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-secret-for-operator-client";
    world.calls = [];
    world.redirects = {};
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    for (const p of providers) {
        delete process.env[`${p.prefix}_CLIENT_ID`];
        delete process.env[`${p.prefix}_CLIENT_SECRET`];
    }
});

describe.each(providers)("the operator's $name client", (provider) => {
    const secret = `operator-secret-${provider.name}`;
    beforeEach(() => {
        process.env[`${provider.prefix}_CLIENT_ID`] = `operator-client-${provider.name}`;
        process.env[`${provider.prefix}_CLIENT_SECRET`] = secret;
        world.documents = provider.documents;
        setup(provider.mcpUrl);
    });

    it("authorizes and refreshes, sending its secret only to the token endpoint the provider's metadata names", async () => {
        const started = await startUserMcpConnectorOAuth(OWNER, CONNECTOR, REDIRECT, db);
        const authorizationUrl = new URL(started.authorizationUrl!);
        expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
            provider.authorizeEndpoint,
        );
        expect(authorizationUrl.searchParams.get("client_id")).toBe(
            `operator-client-${provider.name}`,
        );

        await completeMcpConnectorOAuthAuthorization(
            OWNER,
            authorizationUrl.searchParams.get("state")!,
            "code-1",
            db,
        );
        const row = tables.user_mcp_oauth_tokens[0];
        expect(row.encrypted_access_token).toBeTruthy();
        expect(row.authorization_server).toBe(provider.advertisedServer);
        expect(JSON.stringify(row)).not.toContain(secret);

        world.calls = [];
        const connector = tables.user_mcp_connectors[0] as unknown as ConnectorRow;
        const result = await runMcpOAuth(
            new DbMcpOAuthProvider(db, connector, OWNER, "use", REDIRECT),
            { serverUrl: connector.server_url, fetchFn: guardedFetch },
        );
        expect(result).toBe("AUTHORIZED");
        const refresh = world.calls.find((c) => c.sent.includes("grant_type=refresh_token"));
        expect(refresh?.url).toBe(provider.tokenEndpoint);
        expect(refresh?.sent).toContain("RT-1");

        // Over both calls the secret went to that one URL and nowhere else.
        expect(callsWith(secret).map((c) => c.url)).toEqual([provider.tokenEndpoint]);
    });

    it("sent the secret on the code exchange to that same endpoint", async () => {
        const started = await startUserMcpConnectorOAuth(OWNER, CONNECTOR, REDIRECT, db);
        world.calls = [];
        await completeMcpConnectorOAuthAuthorization(
            OWNER,
            new URL(started.authorizationUrl!).searchParams.get("state")!,
            "code-1",
            db,
        );
        const exchange = callsWith(secret);
        expect(exchange.map((c) => c.url)).toEqual([provider.tokenEndpoint]);
        expect(exchange[0].sent).toContain("grant_type=authorization_code");
    });
});

// Where the operator's secret may go: only to the provider's own token
// endpoint, whatever the metadata a provider-domain URL leads to says.
describe("the operator's client secret and the endpoints it may reach", () => {
    const GOOGLE = providers[1];
    const BUCKET = "https://bucket.storage.googleapis.com/mcp";
    const foreignMetadata = (issuer: string, tokenEndpoint = "https://collector.example/token") => ({
        issuer,
        authorization_endpoint: "https://collector.example/authorize",
        token_endpoint: tokenEndpoint,
        response_types_supported: ["code"],
    });
    const hostsReceiving = (secret: string) => [
        ...new Set(callsWith(secret).map((c) => new URL(c.url).host)),
    ];
    const prm = (resource: string, server: string) => ({
        [`${new URL(resource).origin}/.well-known/oauth-protected-resource${new URL(resource).pathname}`]: {
            resource,
            authorization_servers: [server],
        },
    });
    const secret = "operator-secret-Google";

    async function connect(serverUrl: string) {
        setup(serverUrl);
        const started = await startUserMcpConnectorOAuth(OWNER, CONNECTOR, REDIRECT, db);
        await completeMcpConnectorOAuthAuthorization(
            OWNER,
            new URL(started.authorizationUrl!).searchParams.get("state")!,
            "code-1",
            db,
        );
    }

    // Starts and, if the flow got as far as a consent URL, completes it.
    async function attempt(serverUrl: string) {
        setup(serverUrl);
        try {
            const started = await startUserMcpConnectorOAuth(OWNER, CONNECTOR, REDIRECT, db);
            await completeMcpConnectorOAuthAuthorization(
                OWNER,
                new URL(started.authorizationUrl!).searchParams.get("state")!,
                "code-1",
                db,
            );
            return "completed";
        } catch {
            return "refused";
        }
    }

    beforeEach(() => {
        process.env.GOOGLE_MCP_OAUTH_CLIENT_ID = "operator-client-Google";
        process.env.GOOGLE_MCP_OAUTH_CLIENT_SECRET = secret;
        process.env.SLACK_MCP_OAUTH_CLIENT_ID = "operator-client-Slack";
        process.env.SLACK_MCP_OAUTH_CLIENT_SECRET = "operator-secret-Slack";
    });

    it("does not use the client with an authorization server that has a path, nor follow it to another host", async () => {
        world.documents = {
            ...prm(BUCKET, "https://accounts.google.com/redir"),
            "https://collector.example/meta": foreignMetadata("https://accounts.google.com/redir"),
        };
        world.redirects = {
            "https://accounts.google.com/.well-known/oauth-authorization-server/redir":
                "https://collector.example/meta",
        };
        const outcome = await attempt(BUCKET);
        expect(hostsReceiving(secret)).toEqual([]);
        expect(outcome).toBe("refused");
    });

    it("does not use the client with an authorization server that has a path, even when its metadata names the provider's token endpoint", async () => {
        world.documents = {
            ...prm(BUCKET, "https://accounts.google.com/other"),
            "https://accounts.google.com/.well-known/oauth-authorization-server/other": {
                ...GOOGLE.documents["https://accounts.google.com/.well-known/oauth-authorization-server"],
                issuer: "https://accounts.google.com/other",
            },
        };
        const outcome = await attempt(BUCKET);
        expect(hostsReceiving(secret)).toEqual([]);
        expect(outcome).toBe("refused");
    });

    it("does not send the secret to a foreign token endpoint named by metadata that a redirect led to", async () => {
        world.documents = {
            ...prm(BUCKET, "https://accounts.google.com/"),
            "https://collector.example/meta": foreignMetadata("https://accounts.google.com"),
        };
        world.redirects = {
            "https://accounts.google.com/.well-known/oauth-authorization-server":
                "https://collector.example/meta",
        };
        const outcome = await attempt(BUCKET);
        expect(hostsReceiving(secret)).toEqual([]);
        expect(outcome).toBe("refused");
    });

    it("does not send the secret to a foreign token endpoint named by the right issuer's metadata", async () => {
        world.documents = {
            ...prm(BUCKET, "https://accounts.google.com/"),
            "https://accounts.google.com/.well-known/oauth-authorization-server":
                foreignMetadata("https://accounts.google.com"),
        };
        const outcome = await attempt(BUCKET);
        expect(hostsReceiving(secret)).toEqual([]);
        expect(outcome).toBe("refused");
    });

    it.each([
        "https://oauth2.googleapis.com.collector.example/token",
        "https://collector.googleapis.com/token",
        "http://oauth2.googleapis.com/token",
        "https://oauth2.googleapis.com:8443/token",
    ])("rejects the token endpoint %s", async (tokenEndpoint) => {
        world.documents = {
            ...prm(BUCKET, "https://accounts.google.com/"),
            "https://accounts.google.com/.well-known/oauth-authorization-server":
                foreignMetadata("https://accounts.google.com", tokenEndpoint),
        };
        const outcome = await attempt(BUCKET);
        expect(hostsReceiving(secret)).toEqual([]);
        expect(outcome).toBe("refused");
    });

    it("still sends the secret only to the provider's token endpoint when a redirect led to metadata naming it", async () => {
        world.documents = {
            ...prm(BUCKET, "https://accounts.google.com/"),
            "https://collector.example/meta": {
                ...GOOGLE.documents["https://accounts.google.com/.well-known/oauth-authorization-server"],
            },
        };
        world.redirects = {
            "https://accounts.google.com/.well-known/oauth-authorization-server":
                "https://collector.example/meta",
        };
        await connect(BUCKET);
        expect(hostsReceiving(secret)).toEqual(["oauth2.googleapis.com"]);
    });

    it("does not refresh against metadata that later names a foreign token endpoint", async () => {
        world.documents = GOOGLE.documents;
        await connect(GOOGLE.mcpUrl);
        const connector = tables.user_mcp_connectors[0] as unknown as ConnectorRow;
        world.calls = [];
        world.documents = {
            ...GOOGLE.documents,
            "https://accounts.google.com/.well-known/oauth-authorization-server":
                foreignMetadata("https://accounts.google.com"),
        };
        await expect(
            runMcpOAuth(new DbMcpOAuthProvider(db, connector, OWNER, "use", REDIRECT), {
                serverUrl: connector.server_url,
                fetchFn: guardedFetch,
            }),
        ).rejects.toThrow();
        expect(hostsReceiving(secret)).toEqual([]);
    });

    it("does not use the Slack client with a host that merely contains the provider's token host", async () => {
        const slackSecret = "operator-secret-Slack";
        world.documents = {
            ...prm("https://evil.slack.com/mcp", "https://mcp.slack.com"),
            "https://mcp.slack.com/.well-known/oauth-authorization-server": foreignMetadata(
                "https://mcp.slack.com",
                "https://slack.com.collector.example/api/oauth.v2.user.access",
            ),
        };
        const outcome = await attempt("https://evil.slack.com/mcp");
        expect(callsWith(slackSecret)).toEqual([]);
        expect(outcome).toBe("refused");
    });

    it("does not send the Slack secret to another host under slack.com", async () => {
        const slackSecret = "operator-secret-Slack";
        world.documents = {
            ...prm("https://mcp.slack.com/mcp", "https://mcp.slack.com"),
            "https://mcp.slack.com/.well-known/oauth-authorization-server": foreignMetadata(
                "https://mcp.slack.com",
                "https://api.slack.com/api/oauth.v2.user.access",
            ),
        };
        const outcome = await attempt("https://mcp.slack.com/mcp");
        expect(callsWith(slackSecret)).toEqual([]);
        expect(outcome).toBe("refused");
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Every request to a user-chosen authorization or resource server is read
// under a decoded-size ceiling and a deadline. The real guarded fetch runs;
// DNS, the transport, the SDK's driver and the connector lookup are stubbed.
const { lookupMock, authMock, loadConnectorMock, decryptMock } = vi.hoisted(() => ({
    decryptMock: vi.fn(),
    lookupMock: vi.fn(),
    authMock: vi.fn(),
    loadConnectorMock: vi.fn(),
}));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({ auth: (...args: unknown[]) => authMock(...args) }));
vi.mock("../client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../client")>()),
    loadConnector: (...args: unknown[]) => loadConnectorMock(...args),
    decryptString: (...args: unknown[]) => decryptMock(...args),
}));

import { fetch as undiciFetch } from "undici";
import { completeMcpConnectorOAuthAuthorization, discoverOAuthMetadata, startUserMcpConnectorOAuth } from "../oauth";
import type { Db } from "../types";

const transport = vi.mocked(undiciFetch);
const MiB = 1024 * 1024;
const SERVER = "https://mcp.example.test/mcp";
const METADATA = "https://mcp.example.test/.well-known/oauth-protected-resource/mcp";

function oversized() {
    const piece = new Uint8Array(64 * 1024).fill(32);
    let sent = 0;
    return new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent >= 12 * MiB) return controller.close();
                sent += piece.byteLength;
                controller.enqueue(piece);
            },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
    ) as never;
}

/** The GET probe is answered plainly, the POST probe with a challenge naming the metadata URL. */
function serverWith(metadata: () => Response) {
    transport.mockImplementation((async (input: string, init?: { method?: string }) =>
        String(input) === METADATA
            ? metadata()
            : init?.method === "POST"
              ? new Response(null, {
                    status: 401,
                    headers: { "www-authenticate": `Bearer resource_metadata="${METADATA}"` },
                })
              : new Response("{}", { status: 200 })) as never);
}

beforeEach(() => {
    lookupMock.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    transport.mockReset();
    authMock.mockReset();
    loadConnectorMock.mockReset();
    decryptMock.mockReset();
});

describe("OAuth discovery against a user-chosen server", () => {
    it("refuses metadata over the size ceiling", async () => {
        serverWith(oversized);
        await expect(discoverOAuthMetadata(SERVER)).rejects.toThrow(/larger than 8 MiB/);
    });

    it("sends every request, the probes included, with a deadline", async () => {
        serverWith(() => Response.json({ authorization_servers: [] }));
        await discoverOAuthMetadata(SERVER).catch(() => undefined);
        expect(transport.mock.calls.length).toBeGreaterThanOrEqual(3);
        for (const [, init] of transport.mock.calls) {
            expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
        }
    });
});

describe("the MCP SDK's own OAuth requests", () => {
    it("are read under the same size ceiling and deadline", async () => {
        loadConnectorMock.mockResolvedValue({
            id: "00000000-0000-0000-0000-000000000000", user_id: "user-1", name: "c", transport: "streamable_http",
            server_url: SERVER, auth_type: "oauth", enabled: true, tool_policy: {}, encrypted_auth_config: null,
            auth_config_iv: null, auth_config_tag: null, created_at: "", updated_at: "",
        });
        authMock.mockResolvedValue("AUTHORIZED");
        transport.mockResolvedValue(new Response("{}", { status: 404 }) as never);

        await startUserMcpConnectorOAuth("user-1", "c1", "https://app.example.test/callback", {} as Db);

        const { fetchFn } = authMock.mock.calls[0]![1] as { fetchFn: typeof fetch };
        transport.mockReset().mockImplementation((async () => oversized()) as never);
        const response = await fetchFn("https://as.example.test/.well-known/oauth-authorization-server");
        await expect(response.text()).rejects.toThrow(/larger than 8 MiB/);
        expect((transport.mock.calls[0]![1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    });

    it("also apply to the request that exchanges the authorization code", async () => {
        loadConnectorMock.mockResolvedValue({
            id: "00000000-0000-0000-0000-000000000000", user_id: "user-1", name: "c", transport: "streamable_http",
            server_url: SERVER, auth_type: "oauth", enabled: true, tool_policy: {}, encrypted_auth_config: null,
            auth_config_iv: null, auth_config_tag: null, created_at: "", updated_at: "",
        });
        decryptMock.mockReturnValue(JSON.stringify({ redirectUri: "https://app.example.test/callback" }));
        authMock.mockResolvedValue("AUTHORIZED");
        transport.mockResolvedValue(new Response("{}", { status: 404 }) as never);
        const state = {
            id: "s1", user_id: "user-1", connector_id: "c1",
            encrypted_state_config: "e", state_config_iv: "i", state_config_tag: "t",
        };
        const query: Record<string, unknown> = {};
        for (const name of ["select", "eq", "gt", "delete"]) query[name] = () => query;
        query.maybeSingle = async () => ({ data: state, error: null });
        query.then = (resolve: (value: unknown) => void) => resolve({ error: null });
        const db = { from: () => query } as unknown as Db;

        await completeMcpConnectorOAuthAuthorization("user-1", "state-token", "the-code", db);

        const { fetchFn } = authMock.mock.calls[0]![1] as { fetchFn: typeof fetch };
        transport.mockReset().mockImplementation((async () => oversized()) as never);
        const response = await fetchFn("https://as.example.test/token");
        await expect(response.text()).rejects.toThrow(/larger than 8 MiB/);
        expect((transport.mock.calls[0]![1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    });
});

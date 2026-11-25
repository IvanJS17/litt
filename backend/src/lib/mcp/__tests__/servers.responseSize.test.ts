import { beforeEach, describe, expect, it, vi } from "vitest";

// A connector's server answers under a decoded-size ceiling, and an answer over
// it reaches the person as that, never as a request to authorize. The real
// guarded fetch and the real MCP client run; DNS and the transport are stubbed.
const { lookupMock, discover } = vi.hoisted(() => ({ lookupMock: vi.fn(), discover: vi.fn() }));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));
// The server's OAuth metadata is readable: a failed call must not be mistaken for a request to authorize.
vi.mock("../oauth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../oauth")>()),
    discoverOAuthMetadata: (...args: unknown[]) => discover(...args),
}));

import { fetch as undiciFetch } from "undici";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import { McpOAuthRequiredError } from "../oauth";
import { refreshUserMcpConnectorTools } from "../servers";

const transport = vi.mocked(undiciFetch);
const MiB = 1024 * 1024;

function connectorDb() {
    const row = {
        id: "c1", user_id: "u1", name: "x", transport: "streamable_http", server_url: "https://mcp.example.test/mcp",
        auth_type: "none", enabled: true, tool_policy: null, encrypted_auth_config: null, auth_config_iv: null,
        auth_config_tag: null, created_at: "", updated_at: "",
    };
    const mem = memoryDb({ user_mcp_connectors: [row as unknown as Row], user_mcp_connector_tools: [] });
    return {
        from(table: string) {
            const builder = mem.db.from(table) as unknown as Record<string, unknown>;
            builder.upsert = async () => ({ error: null });
            return builder;
        },
    } as never;
}

/** `total` bytes of `fill` in 64 KiB pieces. */
function body(total: number, fill: string) {
    const piece = new TextEncoder().encode(fill.repeat(64 * 1024).slice(0, 64 * 1024));
    let sent = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (sent >= total) return controller.close();
            sent += piece.byteLength;
            controller.enqueue(piece);
        },
    });
}

beforeEach(() => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "test-secret";
    lookupMock.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    transport.mockReset();
    discover.mockReset().mockResolvedValue({ authorizationServer: "https://auth.example.test" });
});

describe("a connector's answer over the size ceiling", () => {
    it("is refused as too large, not as a request to authorize", async () => {
        transport.mockImplementation(async () =>
            new Response(body(12 * MiB, "x"), { status: 200, headers: { "content-type": "application/json" } }) as never);
        const failure = await refreshUserMcpConnectorTools("u1", "c1", connectorDb()).catch((error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(McpOAuthRequiredError);
        expect(failure.message).toMatch(/larger than 8 MiB/);
    }, 10_000);

    it("ends the call at once when it arrives as an event stream, instead of waiting for the request timeout", async () => {
        transport.mockImplementation(async () =>
            new Response(body(12 * MiB, ": keep-alive\n"), { status: 200, headers: { "content-type": "text/event-stream" } }) as never);
        const started = Date.now();
        const failure = await refreshUserMcpConnectorTools("u1", "c1", connectorDb()).catch((error) => error);
        expect(failure.message).toMatch(/larger than 8 MiB/);
        expect(Date.now() - started).toBeLessThan(5_000);
    }, 10_000);
});

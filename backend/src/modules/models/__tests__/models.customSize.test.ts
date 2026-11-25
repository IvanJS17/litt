import { beforeEach, describe, expect, it, vi } from "vitest";

// The real guarded fetch runs; only DNS and the transport are stubbed, so the
// size ceiling that applies is the one the model list asks for.
const { lookupMock, getEffectiveApiKeys } = vi.hoisted(() => ({
    lookupMock: vi.fn(),
    getEffectiveApiKeys: vi.fn(),
}));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));
vi.mock("../../../lib/providerCredentials/index", () => ({ getEffectiveApiKeys }));

import { fetch as undiciFetch } from "undici";
import { listCustomEndpointModels } from "../models.compatible";

const transport = vi.mocked(undiciFetch);

/** A list of `count` models, sent in small pieces so none is held whole. */
function listOf(count: number) {
    const pulled = { bytes: 0 };
    const encoder = new TextEncoder();
    let sent = -1;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            let text: string;
            if (sent < 0) text = '{"data":[';
            else if (sent < count) text = `${sent ? "," : ""}{"id":"model-${String(sent).padStart(6, "0")}"}`;
            else {
                text = "]}";
                sent = Number.MAX_SAFE_INTEGER;
            }
            const bytes = encoder.encode(text);
            pulled.bytes += bytes.byteLength;
            controller.enqueue(bytes);
            if (text === "]}") controller.close();
            else sent += 1;
        },
    });
    const response = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    return { response: response as never, pulled };
}

beforeEach(() => {
    lookupMock.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    transport.mockReset();
    getEffectiveApiKeys.mockReset().mockResolvedValue({
        custom: "private-key",
        keySources: { custom: "user" },
        providerSettings: { custom: { baseUrl: "https://llm.example.com/v1" } },
    });
});

describe("a custom endpoint's model list", () => {
    it("is read in full when it is an ordinary list", async () => {
        transport.mockResolvedValue(listOf(500).response);
        const result = await listCustomEndpointModels({} as never, "user-1");
        expect(result).toMatchObject({ ok: true });
        expect((result as { models: unknown[] }).models).toHaveLength(500);
    });

    it("is refused, and no longer read, once it passes the size ceiling", async () => {
        const { response, pulled } = listOf(200_000); // about 6 MB of ids
        transport.mockResolvedValue(response);
        const result = await listCustomEndpointModels({} as never, "user-1");
        expect(result).toMatchObject({ ok: false, kind: "upstream" });
        expect(pulled.bytes).toBeLessThan(2 * 1024 * 1024);
    });
});

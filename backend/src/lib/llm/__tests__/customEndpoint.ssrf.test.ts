import { beforeEach, describe, expect, it, vi } from "vitest";

// LiTT governed BYOK (ledger 16.3, "Provider catalog, credentials and model
// selection"): `custom` is the only provider whose base URL a user sets, so
// every request it makes must be refused before it leaves when the
// destination is loopback, private, link-local or cloud metadata — directly,
// through DNS, or after a redirect. Unlike providers.byok.test.ts, the real
// guardedFetch runs here; only DNS and the undici transport are stubbed, so a
// call that reaches `undiciFetch` is a request that left.

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: vi.fn() };
});

import { fetch as undiciFetch } from "undici";
import { completeWithProvider } from "../providers";

const transport = vi.mocked(undiciFetch);

function resolvesTo(address: string) {
  lookupMock.mockResolvedValue([
    { address, family: address.includes(":") ? 6 : 4 },
  ]);
}

function run(baseUrl: string) {
  return completeWithProvider({
    model: "custom/any-model",
    user: "Summarize the clause",
    apiKeys: {
      custom: "sk-custom",
      providerSettings: { custom: { baseUrl } },
    },
  });
}

beforeEach(() => {
  lookupMock.mockReset();
  transport.mockReset();
});

describe("custom endpoint: internal destinations never receive a request", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["private 10/8", "10.20.30.40"],
    ["cloud metadata", "169.254.169.254"],
    ["IPv6 loopback", "::1"],
  ])(
    "refuses a host that resolves to %s (%s) before anything leaves",
    async (_label, address) => {
      resolvesTo(address);
      await expect(run("https://llm.firm.example/v1")).rejects.toThrow(
        /public address/,
      );
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it("does not follow a redirect from a public endpoint to an internal one", async () => {
    resolvesTo("93.184.216.34");
    transport.mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      }) as never,
    );
    await expect(run("https://llm.firm.example/v1")).rejects.toThrow();
    // One request to the public endpoint; the redirect is never followed.
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]?.[0])).toBe(
      "https://llm.firm.example/v1/chat/completions",
    );
  });
});

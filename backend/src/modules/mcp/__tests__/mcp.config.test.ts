import { afterEach, describe, expect, it, vi } from "vitest";

import { mcpConfig } from "../mcp.config";
import { issueTokens } from "../mcp.tokens";
import { nowIso, type GrantRow } from "../mcp.shared";

type Config = ReturnType<typeof mcpConfig>;

// Each numeric setting takes only a whole number written in plain digits from 1 up.
const SETTINGS: { name: string; read: (c: Config) => number; fallback: number; unit: number }[] = [
    { name: "LITT_MCP_ACCESS_TTL_SECONDS", read: (c) => c.accessTtlSeconds, fallback: 3600, unit: 1 },
    { name: "LITT_MCP_REFRESH_TTL_DAYS", read: (c) => c.refreshTtlSeconds, fallback: 30 * 86_400, unit: 86_400 },
    { name: "LITT_MCP_GRANT_MAX_DAYS", read: (c) => c.grantMaxAgeSeconds, fallback: 90 * 86_400, unit: 86_400 },
    { name: "LITT_MCP_UNAPPROVED_CLIENTS_MAX", read: (c) => c.unapprovedClientsMax, fallback: 10_000, unit: 1 },
    { name: "RATE_LIMIT_MCP_GRANT_READ_MAX", read: (c) => c.rateLimits.readMax, fallback: 120, unit: 1 },
    { name: "RATE_LIMIT_MCP_GRANT_READ_WINDOW_SECONDS", read: (c) => c.rateLimits.readWindowMs, fallback: 60_000, unit: 1000 },
    { name: "RATE_LIMIT_MCP_GRANT_WRITE_MAX", read: (c) => c.rateLimits.writeMax, fallback: 30, unit: 1 },
    { name: "RATE_LIMIT_MCP_GRANT_WRITE_WINDOW_MINUTES", read: (c) => c.rateLimits.writeWindowMs, fallback: 15 * 60_000, unit: 60_000 },
];

const configWith = (name: string, value: string) => mcpConfig({ [name]: value } as NodeJS.ProcessEnv);

afterEach(() => vi.restoreAllMocks());

describe("numeric settings of the connected-applications server", () => {
    for (const setting of SETTINGS) {
        describe(setting.name, () => {
            for (const value of ["10,000", "10k", "1e9", "2.5", "-5", "+5", "0", "010", "05", "0x10", "1_000", "", "  ", "9".repeat(16)]) {
                it(`uses the default for ${JSON.stringify(value)}`, () => {
                    vi.spyOn(console, "warn").mockImplementation(() => {});
                    expect(setting.read(configWith(setting.name, value))).toBe(setting.fallback);
                });
            }
            it("uses the default when unset", () => {
                expect(setting.read(mcpConfig({} as NodeJS.ProcessEnv))).toBe(setting.fallback);
            });
            it("takes a whole number in digits, with or without spaces around it", () => {
                expect(setting.read(configWith(setting.name, "250"))).toBe(250 * setting.unit);
                expect(setting.read(configWith(setting.name, " 250 "))).toBe(250 * setting.unit);
            });
        });
    }
});

describe("ceilings of the settings that become times and dates", () => {
    const fifteenDigits = "9".repeat(15);
    const grant = (): GrantRow =>
        ({ id: "g1", scopes: ["litt.read"], expires_at: new Date(Date.now() + 10 * 365 * 86_400_000).toISOString() }) as GrantRow;
    const fakeDb = () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as never;

    it("takes a larger access lifetime as one year, and the date can still be made", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { accessTtlSeconds } = configWith("LITT_MCP_ACCESS_TTL_SECONDS", fifteenDigits);
        expect(accessTtlSeconds).toBe(31_536_000);
        expect(() => nowIso(accessTtlSeconds)).not.toThrow();
        expect(configWith("LITT_MCP_ACCESS_TTL_SECONDS", "31536000").accessTtlSeconds).toBe(31_536_000);
        expect(configWith("LITT_MCP_ACCESS_TTL_SECONDS", "31536001").accessTtlSeconds).toBe(31_536_000);
    });

    it("takes a larger refresh lifetime as 36,500 days, and the date can still be made", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { refreshTtlSeconds } = configWith("LITT_MCP_REFRESH_TTL_DAYS", fifteenDigits);
        expect(refreshTtlSeconds).toBe(36_500 * 86_400);
        expect(() => nowIso(refreshTtlSeconds)).not.toThrow();
        expect(configWith("LITT_MCP_REFRESH_TTL_DAYS", "36500").refreshTtlSeconds).toBe(36_500 * 86_400);
    });

    it("takes a larger grant age as 36,500 days, and the date can still be made", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { grantMaxAgeSeconds } = configWith("LITT_MCP_GRANT_MAX_DAYS", fifteenDigits);
        expect(grantMaxAgeSeconds).toBe(36_500 * 86_400);
        expect(() => nowIso(grantMaxAgeSeconds)).not.toThrow();
    });

    it("still issues tokens when the lifetimes are written with fifteen digits", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("LITT_MCP_ACCESS_TTL_SECONDS", fifteenDigits);
        vi.stubEnv("LITT_MCP_REFRESH_TTL_DAYS", fifteenDigits);
        try {
            const tokens = await issueTokens(fakeDb(), grant());
            expect(tokens.expires_in).toBeGreaterThan(0);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("writes one line that names the setting and says the ceiling is used, without the value", async () => {
        vi.resetModules();
        const fresh = (await import("../mcp.config.js")).mcpConfig;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const value = "123456789012345";
        fresh({ LITT_MCP_REFRESH_TTL_DAYS: value } as NodeJS.ProcessEnv);
        fresh({ LITT_MCP_REFRESH_TTL_DAYS: value } as NodeJS.ProcessEnv);
        const written = warn.mock.calls.filter((call) => JSON.stringify(call).includes("LITT_MCP_REFRESH_TTL_DAYS"));
        expect(written).toHaveLength(1);
        expect(JSON.stringify(written[0])).toContain("ceiling");
        expect(JSON.stringify(warn.mock.calls)).not.toContain(value);
    });
});

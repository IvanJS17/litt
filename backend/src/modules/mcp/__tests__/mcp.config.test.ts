import { describe, expect, it } from "vitest";

import { mcpConfig } from "../mcp.config";

// Each numeric setting takes only a whole number written in plain digits from 1 up.
const SETTINGS = [
    { name: "LITT_MCP_UNAPPROVED_CLIENTS_MAX", read: (c: ReturnType<typeof mcpConfig>) => c.unapprovedClientsMax, fallback: 10_000 },
    { name: "RATE_LIMIT_MCP_GRANT_READ_MAX", read: (c: ReturnType<typeof mcpConfig>) => c.rateLimits.readMax, fallback: 120 },
];

describe("numeric settings of the connected-applications server", () => {
    for (const setting of SETTINGS) {
        describe(setting.name, () => {
            for (const value of ["10,000", "10k", "1e9", "2.5", "-5", "+5", "0", "010", "", "  "]) {
                it(`uses the default for ${JSON.stringify(value)}`, () => {
                    expect(setting.read(mcpConfig({ [setting.name]: value } as NodeJS.ProcessEnv))).toBe(setting.fallback);
                });
            }
            it("uses the default when unset", () => {
                expect(setting.read(mcpConfig({} as NodeJS.ProcessEnv))).toBe(setting.fallback);
            });
            it("takes a whole number in digits, with or without spaces around it", () => {
                expect(setting.read(mcpConfig({ [setting.name]: "250" } as NodeJS.ProcessEnv))).toBe(250);
                expect(setting.read(mcpConfig({ [setting.name]: " 250 " } as NodeJS.ProcessEnv))).toBe(250);
            });
        });
    }
});

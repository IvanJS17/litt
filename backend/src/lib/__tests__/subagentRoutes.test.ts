import { describe, expect, it } from "vitest";
import {
    EMPTY_SUBAGENT_ROUTES,
    MAX_SUBAGENT_ROUTES,
    storedSubagentRoutes,
    storedSubagentRoutesBytes,
    validateSubagentRoutes,
} from "../subagentRoutes";

const route = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    description: `Route ${name}.`,
    model: "gemini-3.8-flash",
    ...extra,
});

describe("validateSubagentRoutes", () => {
    it("accepts named routes with a default and keeps their order", () => {
        const result = validateSubagentRoutes({
            routes: [route("fast"), route("deep", { model: "claude-opus-5-5", reasoning: "high" })],
            default: "fast",
        });

        expect(result).toEqual({
            ok: true,
            value: {
                routes: [
                    { name: "fast", description: "Route fast.", model: "gemini-3.8-flash" },
                    {
                        name: "deep",
                        description: "Route deep.",
                        model: "claude-opus-5-5",
                        reasoning: "high",
                    },
                ],
                default: "fast",
            },
        });
    });

    it.each([
        ["a name outside [a-z0-9-]", { routes: [route("Fast")] }, "name"],
        ["a name over 32 characters", { routes: [route("a".repeat(33))] }, "name"],
        ["a repeated name", { routes: [route("fast"), route("fast")] }, "repeats"],
        ["a description over 200 characters", { routes: [route("fast", { description: "x".repeat(201) })] }, "description"],
        ["a description of two lines", { routes: [route("fast", { description: "one\ntwo" })] }, "description"],
        ["an empty description", { routes: [route("fast", { description: " " })] }, "description"],
        ["an unknown model", { routes: [route("fast", { model: "not-a-model" })] }, "model"],
        ["an unknown reasoning level", { routes: [route("fast", { reasoning: "extreme" })] }, "reasoning"],
        ["a default that is not a route", { routes: [route("fast")], default: "deep" }, "default"],
        [
            `more than ${MAX_SUBAGENT_ROUTES} routes`,
            { routes: Array.from({ length: MAX_SUBAGENT_ROUTES + 1 }, (_, i) => route(`r${i}`)) },
            "at most",
        ],
        ["an unexpected field", { routes: [route("fast", { provider: "gemini" })] }, "field"],
    ])("rejects %s", (_case, body, detail) => {
        const result = validateSubagentRoutes(body);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.detail).toContain(detail);
    });
});

describe("storedSubagentRoutes", () => {
    it("reads nothing but well-formed routes, and drops a default that lost its route", () => {
        expect(storedSubagentRoutes(null)).toEqual(EMPTY_SUBAGENT_ROUTES);
        expect(
            storedSubagentRoutes({
                routes: [route("fast"), route("Bad Name")],
                default: "Bad Name",
            }),
        ).toEqual({
            routes: [{ name: "fast", description: "Route fast.", model: "gemini-3.8-flash" }],
            default: null,
        });
    });

    it("keeps a route whose model left the catalog, marked unavailable, and keeps it as the default", () => {
        expect(
            storedSubagentRoutes({
                routes: [route("fast"), route("old", { model: "retired-model-1" })],
                default: "old",
            }),
        ).toEqual({
            routes: [
                { name: "fast", description: "Route fast.", model: "gemini-3.8-flash" },
                { name: "old", description: "Route old.", model: "retired-model-1", unavailable: true },
            ],
            default: "old",
        });
    });
});

describe("validateSubagentRoutes with a retired route", () => {
    const stored = storedSubagentRoutes({
        routes: [route("fast"), route("old", { model: "retired-model-1" })],
        default: "old",
    });

    it("saves the retired route back unchanged, without the unavailable mark", () => {
        const result = validateSubagentRoutes(
            { routes: stored.routes, default: "fast" },
            stored,
        );

        expect(result).toEqual({
            ok: true,
            value: {
                routes: [
                    { name: "fast", description: "Route fast.", model: "gemini-3.8-flash" },
                    { name: "old", description: "Route old.", model: "retired-model-1" },
                ],
                default: "fast",
            },
        });
    });

    it("refuses the retired model on any other route", () => {
        const result = validateSubagentRoutes(
            { routes: [route("new", { model: "retired-model-1" })], default: null },
            stored,
        );

        expect(result.ok).toBe(false);
        expect(!result.ok && result.detail).toContain("model");
    });
});

describe("validateSubagentRoutes size", () => {
    const routes = (description: string) =>
        Array.from({ length: MAX_SUBAGENT_ROUTES }, (_, i) =>
            route(`${"r".repeat(30)}${i}`.slice(0, 32), { description, reasoning: "xhigh" }),
        );

    it("accepts eight long multibyte descriptions that fit the stored limit", () => {
        expect(validateSubagentRoutes({ routes: routes("案".repeat(200)), default: null }).ok).toBe(true);
    });

    it("refuses, instead of letting the database fail, routes over the 6000-byte stored limit", () => {
        const result = validateSubagentRoutes({ routes: routes("\u0007".repeat(200)), default: null });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.detail).toContain("too long");
    });

    it("measures the stored size the way the database does", () => {
        expect(storedSubagentRoutesBytes({ routes: [route("a")], default: null })).toBe(
            Buffer.byteLength(
                '{"routes": [{"name": "a", "model": "gemini-3.8-flash", "description": "Route a."}], "default": null}',
            ),
        );
    });
});

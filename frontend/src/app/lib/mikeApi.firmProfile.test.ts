import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgFirmProfile, saveOrgFirmProfile } from "./mikeApi";

// The firm profile's client calls: route, method and body, identifier encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ profile: null, can_manage: true }), { status: 200 }));
});

describe("firm profile API", () => {
    it.each([
        ["get", () => getOrgFirmProfile("o 1"), "GET", undefined],
        ["save", () => saveOrgFirmProfile("o 1", { size: "1" }), "PUT", { profile: { size: "1" } }],
        ["clear", () => saveOrgFirmProfile("o 1", null), "PUT", { profile: null }],
    ] as const)("%s", async (_name, call, method, body) => {
        await call();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/orgs/o%201/profile");
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });
});

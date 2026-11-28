import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgStorageUsage, getUserStorageUsage } from "./mikeApi";

// The two reads of the storage space: route and method, identifier encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ usedBytes: 5, limitBytes: 10 }), { status: 200 }));
});

describe("storage usage API", () => {
    it.each([
        ["person", () => getUserStorageUsage(), "/api/user/storage"],
        ["firm", () => getOrgStorageUsage("o 1"), "/api/orgs/o%201/storage"],
    ] as const)("reads the %s's space", async (_name, call, url) => {
        await expect(call()).resolves.toEqual({ usedBytes: 5, limitBytes: 10 });
        const [requested, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(requested).toBe(url);
        expect(init.method ?? "GET").toBe("GET");
    });

    it("passes an abort signal along", async () => {
        const controller = new AbortController();
        await getUserStorageUsage(controller.signal);
        expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBe(controller.signal);
    });
});

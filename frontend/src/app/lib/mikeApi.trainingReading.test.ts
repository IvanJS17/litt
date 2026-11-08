import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    compareReading,
    getMyReading,
    getMyReadings,
    getPupilReadings,
    getReadingDocument,
    startReading,
    submitReadingFindings,
    swapReading,
} from "./mikeApi";

// The periodic full reading's client calls (training layer 3): route, method
// and body of each, with every identifier encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

describe("training full reading API", () => {
    it.each([
        ["list", () => getMyReadings("o 1"), "GET", "/api/training/me/readings?org_id=o+1", undefined],
        ["one", () => getMyReading("r/1"), "GET", "/api/training/me/readings/r%2F1", undefined],
        ["start", () => startReading("o 1"), "POST", "/api/training/me/readings", { org_id: "o 1" }],
        ["document", () => getReadingDocument("r1"), "GET", "/api/training/me/readings/r1/document", undefined],
        ["swap", () => swapReading("r1"), "POST", "/api/training/me/readings/r1/swap", {}],
        ["findings", () => submitReadingFindings("r1", "Lo que vi"), "PUT", "/api/training/me/readings/r1/findings", { findings: "Lo que vi" }],
        ["compare", () => compareReading("r1"), "POST", "/api/training/me/readings/r1/compare", {}],
        ["compare on a key", () => compareReading("r1", "user:k"), "POST", "/api/training/me/readings/r1/compare", { credential_ref: "user:k" }],
        ["the mentor's list", () => getPupilReadings("o 1", "u/1"), "GET", "/api/orgs/o%201/training/pupils/u%2F1/readings", undefined],
    ] as const)("%s", async (_name, call, method, url, body) => {
        await call();
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });
});

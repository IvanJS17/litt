import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFirmCriterion, deleteFirmCriterion, listFirmCriteria, updateFirmCriterion } from "./mikeApi";

// The firm criteria's client calls (training layer 3): route, method and
// body of each, with every identifier encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

const input = { topic: "Prescripción", position: "Corre desde el vencimiento.", practice: null };

describe("firm criteria API", () => {
    it.each([
        ["list", () => listFirmCriteria("o 1"), "GET", "/api/orgs/o%201/firm-criteria", undefined],
        ["create", () => createFirmCriterion("o 1", input), "POST", "/api/orgs/o%201/firm-criteria", input],
        ["update", () => updateFirmCriterion("o 1", "c/1", input), "PUT", "/api/orgs/o%201/firm-criteria/c%2F1", input],
        ["delete", () => deleteFirmCriterion("o 1", "c/1"), "DELETE", "/api/orgs/o%201/firm-criteria/c%2F1", undefined],
    ] as const)("%s", async (_name, call, method, url, body) => {
        await call();
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { answerRetake, getMyCriterion, getPupilCriterion, startRetake } from "./mikeApi";

// The own map, calibration and retake client calls (training layer 3, card
// 5): route, method and body of each, with every identifier encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

describe("training criterion API", () => {
    it.each([
        ["my criterion", () => getMyCriterion("o 1"), "GET", "/api/training/me/criterion?org_id=o+1", undefined],
        ["the mentor's criterion", () => getPupilCriterion("o 1", "u/1"), "GET", "/api/orgs/o%201/training/pupils/u%2F1/criterion", undefined],
        ["start", () => startRetake("o 1", "amparo"), "POST", "/api/training/me/retakes", { org_id: "o 1", topic_key: "amparo" }],
        ["start on a key", () => startRetake("o 1", "amparo", "user:k"), "POST", "/api/training/me/retakes", { org_id: "o 1", topic_key: "amparo", credential_ref: "user:k" }],
        ["answer", () => answerRetake("r/1", "Mi respuesta"), "PUT", "/api/training/me/retakes/r%2F1/answer", { answer: "Mi respuesta" }],
        ["answer on another key", () => answerRetake("r1", "Mi respuesta", "org:k"), "PUT", "/api/training/me/retakes/r1/answer", { answer: "Mi respuesta", credential_ref: "org:k" }],
    ] as const)("%s", async (_name, call, method, url, body) => {
        await call();
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });
});

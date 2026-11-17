import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    confirmProfileFact,
    createProfileFact,
    getClientProfile,
    rejectProfileFact,
} from "./mikeApi";

// The client profile calls: route, method and body, identifiers encoded, and a
// malformed reply is a failure rather than an empty profile.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
};
const goodFact = { id: "f1", source: { quote: "q" }, events: [] };
const goodProfile = { retainer: true, can_write: true, facts: [], versions: [], people: [] };
beforeEach(() => {
    fetchMock.mockReset();
    reply(goodFact);
});

const M = "/api/projects/p%201/matters/m%201/profile";
describe("client profile API", () => {
    it.each([
        ["get", () => getClientProfile("p 1", "m 1"), M, "GET", undefined, goodProfile],
        ["create", () => createProfileFact("p 1", "m 1", { kind: "other" } as never), `${M}/facts`, "POST", { kind: "other" }, goodFact],
        ["confirm", () => confirmProfileFact("p 1", "m 1", "f 1"), `${M}/facts/f%201/confirm`, "POST", {}, goodFact],
        ["confirm with a note", () => confirmProfileFact("p 1", "m 1", "f 1", { reason: "ok" }), `${M}/facts/f%201/confirm`, "POST", { reason: "ok" }, goodFact],
        ["reject", () => rejectProfileFact("p 1", "m 1", "f 1"), `${M}/facts/f%201/reject`, "POST", {}, goodFact],
        ["reject with a reason", () => rejectProfileFact("p 1", "m 1", "f 1", { reason: "no" }), `${M}/facts/f%201/reject`, "POST", { reason: "no" }, goodFact],
    ] as const)("%s", async (_name, call, path, method, body, answer) => {
        reply(answer);
        await call();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(path);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });

    it("returns what the server answered", async () => {
        reply(goodProfile);
        expect(await getClientProfile("p", "m")).toEqual(goodProfile);
        reply(goodFact);
        expect(await createProfileFact("p", "m", {} as never)).toEqual(goodFact);
    });

    it.each([[{}], [[]], [null], [{ ...goodProfile, facts: {} }], [{ ...goodProfile, versions: null }], [{ ...goodProfile, people: undefined }]])(
        "treats %j as a failed profile load",
        async (body) => {
            reply(body);
            await expect(getClientProfile("p", "m")).rejects.toThrow("Malformed");
        },
    );

    it.each([[{}], [null], [{ id: "f1" }], [{ id: "f1", source: {} }], [{ id: 5, source: {}, events: [] }], [{ ...goodFact, events: null }]])(
        "treats %j as a failed fact",
        async (body) => {
            reply(body);
            await expect(createProfileFact("p", "m", {} as never)).rejects.toThrow("Malformed");
            await expect(confirmProfileFact("p", "m", "f")).rejects.toThrow("Malformed");
            await expect(rejectProfileFact("p", "m", "f")).rejects.toThrow("Malformed");
        },
    );
});

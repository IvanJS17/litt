import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    confirmProfileFact,
    createProfileFact,
    decideProfileFacts,
    extractProfileFacts,
    getClientProfile,
    getProfileExtractionRoute,
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
const goodBatch = { results: [{ fact_id: "f1", outcome: "ok" }] };
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
        ["decide a batch", () => decideProfileFacts("p 1", "m 1", { action: "confirm", factIds: ["f1", "f2"] }), `${M}/facts/batch`, "POST", { action: "confirm", factIds: ["f1", "f2"] }, goodBatch],
        ["reject a batch with a reason", () => decideProfileFacts("p 1", "m 1", { action: "reject", factIds: ["f1"], reason: "no" }), `${M}/facts/batch`, "POST", { action: "reject", factIds: ["f1"], reason: "no" }, goodBatch],
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
        reply(goodBatch);
        expect(await decideProfileFacts("p", "m", { action: "confirm", factIds: ["f1"] })).toEqual(goodBatch);
    });

    it.each([[{}], [null], [[]], [{ results: {} }], [{ results: null }]])("treats %j as a failed batch", async (body) => {
        reply(body);
        await expect(decideProfileFacts("p", "m", { action: "confirm", factIds: ["f1"] })).rejects.toThrow("Malformed");
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

describe("assisted extraction API", () => {
    const route = { provider: "claude", model: "claude-sonnet-5-5" };
    const good = { proposed: 2, discarded_quote_not_found: 1, discarded_invalid: 0, discarded_duplicate: 3, fact_ids: ["f1", "f2"] };

    it("asks where the text would go, and says there is no button when the server says null", async () => {
        reply({ route });
        expect(await getProfileExtractionRoute("p 1", "m 1")).toEqual(route);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${M}/extraction`);
        expect(init.method ?? "GET").toBe("GET");
        reply({ route: null });
        expect(await getProfileExtractionRoute("p", "m")).toBeNull();
    });

    it.each([[{}], [null], [[]], [{ route: {} }], [{ route: { provider: "claude" } }], [{ route: { model: "x" } }], [{ route: { provider: 1, model: 2 } }], [{ route: "claude" }]])(
        "treats %j as a failed route read",
        async (body) => {
            reply(body);
            await expect(getProfileExtractionRoute("p", "m")).rejects.toThrow("Malformed");
        },
    );

    it("runs one version with an empty POST and returns the counts", async () => {
        reply(good);
        expect(await extractProfileFacts("p 1", "m 1", "v 1")).toEqual(good);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${M}/versions/v%201/extract`);
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({});
    });

    it.each([
        [{}],
        [null],
        [[]],
        [{ ...good, proposed: "2" }],
        [{ ...good, proposed: -1 }],
        [{ ...good, proposed: 1.5 }],
        [{ ...good, discarded_quote_not_found: undefined }],
        [{ ...good, discarded_invalid: null }],
        [{ ...good, discarded_duplicate: NaN }],
        [{ ...good, fact_ids: undefined }],
        [{ ...good, fact_ids: "f1" }],
        [{ ...good, fact_ids: [1] }],
    ])("treats %j as a failed run", async (body) => {
        reply(body);
        await expect(extractProfileFacts("p", "m", "v")).rejects.toThrow("Malformed");
    });
});

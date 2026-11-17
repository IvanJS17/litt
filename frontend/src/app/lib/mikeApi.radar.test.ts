import { beforeEach, describe, expect, it, vi } from "vitest";

import { actOnRadarItem, getMatterRadar, getRadarToday } from "./mikeApi";

// The deadline radar calls: route, method and body, identifiers encoded (an item
// key carries a colon), and a malformed reply is a failure rather than an
// empty radar.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
};
const goodItem = { key: "f1:expiry", source: { quote: "q" } };
const goodRadar = { retainer: true, can_write: true, today: "2026-11-16", time_zone: "America/Mexico_City", items: [], people: [] };
const goodToday = { today: "2026-11-16", time_zone: "America/Mexico_City", items: [], truncated: false };
beforeEach(() => {
    fetchMock.mockReset();
    reply(goodItem);
});

const M = "/api/projects/p%201/matters/m%201/radar";
describe("deadline radar API", () => {
    it.each([
        ["get", () => getMatterRadar("p 1", "m 1"), M, "GET", undefined, goodRadar],
        ["ack", () => actOnRadarItem("p 1", "m 1", "f:1:notice", "ack"), `${M}/items/f%3A1%3Anotice/ack`, "POST", {}, goodItem],
        ["done with a note", () => actOnRadarItem("p 1", "m 1", "k", "done", { reason: "ok" }), `${M}/items/k/done`, "POST", { reason: "ok" }, goodItem],
        ["dismiss with a reason", () => actOnRadarItem("p 1", "m 1", "k", "dismiss", { reason: "no" }), `${M}/items/k/dismiss`, "POST", { reason: "no" }, goodItem],
        ["today", () => getRadarToday("org 1"), "/api/orgs/org%201/radar/today", "GET", undefined, goodToday],
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
        reply(goodRadar);
        expect(await getMatterRadar("p", "m")).toEqual(goodRadar);
        reply(goodItem);
        expect(await actOnRadarItem("p", "m", "k", "ack")).toEqual(goodItem);
        reply(goodToday);
        expect(await getRadarToday("o")).toEqual(goodToday);
    });

    it.each([[{}], [[]], [null], [{ ...goodRadar, today: 5 }], [{ ...goodRadar, items: {} }], [{ ...goodRadar, people: undefined }]])(
        "treats %j as a failed radar load",
        async (body) => {
            reply(body);
            await expect(getMatterRadar("p", "m")).rejects.toThrow("Malformed");
        },
    );

    it("accepts an obligation item that has no anchor fact (no source passage)", async () => {
        const item = { key: "contract.notice@1:matter", source: null, obligation: { rule_key: "contract.notice@1" } };
        reply(item);
        expect(await actOnRadarItem("p", "m", item.key, "ack")).toEqual(item);
    });

    it.each([[{}], [null], [{ key: "k" }], [{ key: 5, source: {} }], [{ key: "k", source: null, obligation: null }]])("treats %j as a failed action", async (body) => {
        reply(body);
        await expect(actOnRadarItem("p", "m", "k", "ack")).rejects.toThrow("Malformed");
    });

    it.each([[{}], [null], [[]], [{ today: 5, items: [] }], [{ today: "2026-11-16", items: null }]])(
        "treats %j as a failed today load",
        async (body) => {
            reply(body);
            await expect(getRadarToday("o")).rejects.toThrow("Malformed");
        },
    );
});

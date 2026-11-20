import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    createMatterRequest,
    createRequestType,
    decideTriageItem,
    getDonnaUsage,
    getTriageCard,
    runTriage,
    getMatterRequest,
    getRequestCounts,
    linkMatterRequestRound,
    linkRequestTypePlaybook,
    listRequestTypePlaybooks,
    listMatterRequests,
    listRequestTypes,
    setMatterRetainer,
    unlinkMatterRequestRound,
    unlinkRequestTypePlaybook,
    updateMatterRequest,
    updateRequestType,
} from "./mikeApi";

// The matter requests client calls: route, method and body, identifiers encoded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
};
beforeEach(() => {
    fetchMock.mockReset();
    reply({ types: [], can_manage: false, totals: {}, by_matter: [] });
});

const M = "/api/projects/p%201/matters/m%201";
describe("matter requests API", () => {
    it.each([
        ["list", () => listMatterRequests("p 1", "m 1"), `${M}/requests`, "GET", undefined],
        ["get", () => getMatterRequest("p 1", "m 1", "r 1"), `${M}/requests/r%201`, "GET", undefined],
        ["create", () => createMatterRequest("p 1", "m 1", { title: "x" } as never), `${M}/requests`, "POST", { title: "x" }],
        ["update", () => updateMatterRequest("p 1", "m 1", "r 1", { title: "y" } as never), `${M}/requests/r%201`, "PATCH", { title: "y" }],
        ["link round", () => linkMatterRequestRound("p 1", "m 1", "r 1", { chat_id: "c" } as never), `${M}/requests/r%201/rounds`, "POST", { chat_id: "c" }],
        ["unlink round", () => unlinkMatterRequestRound("p 1", "m 1", "r 1", "d 1"), `${M}/requests/r%201/rounds/d%201`, "DELETE", undefined],
        ["retainer", () => setMatterRetainer("p 1", "m 1", true), `${M}/retainer`, "PUT", { is_retainer: true }],
        ["list types", () => listRequestTypes("o 1"), "/api/orgs/o%201/request-types", "GET", undefined],
        ["create type", () => createRequestType("o 1", "Poderes"), "/api/orgs/o%201/request-types", "POST", { name: "Poderes" }],
        ["counts", () => getRequestCounts("o 1", "month"), "/api/orgs/o%201/requests/counts?period=month", "GET", undefined],
        ["counts of a date", () => getRequestCounts("o 1", "quarter", "2026-11-16"), "/api/orgs/o%201/requests/counts?period=quarter&date=2026-11-16", "GET", undefined],
        ["list type playbooks", async () => { reply({ links: [], available: [] }); return listRequestTypePlaybooks("o 1"); }, "/api/orgs/o%201/request-types/playbooks", "GET", undefined],
        ["link type playbook", async () => { reply({ type_id: "t", playbook_id: "p" }); return linkRequestTypePlaybook("o 1", "t 1", "p 1"); }, "/api/orgs/o%201/request-types/t%201/playbooks", "POST", { playbook_id: "p 1" }],
        ["unlink type playbook", async () => { reply({ unlinked: true }); return unlinkRequestTypePlaybook("o 1", "t 1", "p 1"); }, "/api/orgs/o%201/request-types/t%201/playbooks/p%201", "DELETE", undefined],
        ["update type", () => updateRequestType("o 1", "t 1", { archived: true }), "/api/orgs/o%201/request-types/t%201", "PATCH", { archived: true }],
    ] as const)("%s", async (_name, call, path, method, body) => {
        await call();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(path);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });

    it.each([[{}], [[]], [null], [{ totals: {} }], [{ by_matter: [] }]])("treats %j as failed counts", async (body) => {
        reply(body);
        await expect(getRequestCounts("o 1", "month")).rejects.toThrow("Malformed");
    });

    it("returns the replies of the type playbook calls as they come", async () => {
        const links = { links: [], available: [], can_manage: true };
        reply(links);
        expect(await listRequestTypePlaybooks("o 1")).toEqual(links);
        const link = { type_id: "t", playbook_id: "p", name: "N", linked_at: "x" };
        reply(link);
        expect(await linkRequestTypePlaybook("o 1", "t", "p")).toEqual(link);
        const done = { type_id: "t", playbook_id: "p", unlinked: true };
        reply(done);
        expect(await unlinkRequestTypePlaybook("o 1", "t", "p")).toEqual(done);
    });

    it.each([[{}], [[]], [null], [{ links: [] }], [{ available: [] }], [{ links: {}, available: [] }]])(
        "treats %j as failed type playbooks",
        async (body) => {
            reply(body);
            await expect(listRequestTypePlaybooks("o 1")).rejects.toThrow("Malformed");
        },
    );

    it.each([[{}], [null], [[]], [{ type_id: "t" }], [{ playbook_id: "p" }], [{ type_id: 1, playbook_id: "p" }]])(
        "treats %j as a failed link",
        async (body) => {
            reply(body);
            await expect(linkRequestTypePlaybook("o 1", "t", "p")).rejects.toThrow("Malformed");
        },
    );

    it.each([[{}], [null], [[]], [{ unlinked: false }], [{ unlinked: "true" }]])(
        "treats %j as a failed unlink",
        async (body) => {
            reply(body);
            await expect(unlinkRequestTypePlaybook("o 1", "t", "p")).rejects.toThrow("Malformed");
        },
    );

    it.each([[{}], [[]], [null]])("treats %j as a failed catalog load", async (body) => {
        reply(body);
        await expect(listRequestTypes("o 1")).rejects.toThrow("Malformed");
    });

    const T = `${M}/requests/r%201/triage`;
    it.each([
        ["get triage", () => getTriageCard("p 1", "m 1", "r 1"), T, "GET", undefined],
        ["run triage", () => runTriage("p 1", "m 1", "r 1"), T, "POST", {}],
        ["decide item", () => decideTriageItem("p 1", "m 1", "r 1", "i 1", { decision: "accepted" } as never), `${T}/items/i%201/decision`, "POST", { decision: "accepted" }],
    ] as const)("%s", async (_name, call, path, method, body) => {
        reply({ items: [] });
        expect(await call()).toEqual({ items: [] });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(path);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });

    const usage = {
        month: "2026-11",
        limit: 1000,
        used: 1,
        remaining: 999,
        engines: { jev: { runs: 1, input_tokens: 2, output_tokens: 3, cost_usd: 0.1 }, byok: { runs: 0 } },
        projects: [],
    };
    it("reads the Donna usage of the firm", async () => {
        reply(usage);
        expect(await getDonnaUsage("o 1")).toEqual(usage);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/orgs/o%201/donna/usage");
    });

    it.each([
        [[]],
        [null],
        [{}],
        [{ ...usage, engines: {} }],
        [{ ...usage, engines: { jev: usage.engines.jev } }],
        [{ ...usage, engines: { ...usage.engines, jev: { runs: "1" } } }],
        [{ ...usage, projects: {} }],
        [{ ...usage, used: null }],
    ])("treats %j as failed Donna usage", async (body) => {
        reply(body);
        await expect(getDonnaUsage("o 1")).rejects.toThrow("Malformed");
    });
});

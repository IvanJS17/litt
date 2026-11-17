import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMatterObligationRules, setMatterObligationRule } from "./mikeApi";

// The obligation rules calls: route, method and body, identifiers encoded (a
// rule key carries an @), and a malformed reply is a failure rather than an
// empty catalog.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
};
const goodRules = { retainer: true, can_write: true, rules: [], anchor_choices: [], people: [] };
const goodRule = { key: "contract.notice@1", active: true };
beforeEach(() => fetchMock.mockReset());

const M = "/api/projects/p%201/matters/m%201/radar/rules";
describe("obligation rules API", () => {
    it("reads the rules of a matter", async () => {
        reply(goodRules);
        expect(await getMatterObligationRules("p 1", "m 1")).toEqual(goodRules);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(M);
        expect(init.method ?? "GET").toBe("GET");
    });

    it.each([
        [true, "activate", { anchor_fact_id: "f1", anchor_mode: "first_cycle" }, { anchor_fact_id: "f1", anchor_mode: "first_cycle" }],
        [true, "activate", undefined, {}],
        [false, "deactivate", { anchor_fact_id: "ignored" }, {}],
        [false, "deactivate", undefined, {}],
    ] as const)("turns a rule on (naming its date) or off (%s, %j)", async (on, path, input, body) => {
        reply(goodRule);
        expect(await setMatterObligationRule("p 1", "m 1", "contract.notice@1", on, input as never)).toEqual(goodRule);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${M}/contract.notice%401/${path}`);
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual(body);
    });

    it.each([[{}], [[]], [null], [{ ...goodRules, retainer: "yes" }], [{ ...goodRules, rules: {} }], [{ ...goodRules, anchor_choices: undefined }], [{ ...goodRules, people: undefined }]])(
        "treats %j as a failed load",
        async (body) => {
            reply(body);
            await expect(getMatterObligationRules("p", "m")).rejects.toThrow("Malformed");
        },
    );

    it.each([[{}], [null], [{ key: "k" }], [{ key: 5, active: true }], [{ active: true }]])("treats %j as a failed change", async (body) => {
        reply(body);
        await expect(setMatterObligationRule("p", "m", "k@1", true)).rejects.toThrow("Malformed");
    });
});

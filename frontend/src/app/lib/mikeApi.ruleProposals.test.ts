import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    decideRuleProposal,
    downloadRuleProposals,
    getRuleProposalRoute,
    getRuleProposals,
    proposeObligationRules,
} from "./mikeApi";

// The rule proposal calls (docs/obligation-rules.md, "Rule proposals"): route,
// method and body, identifiers encoded, and a malformed reply is a failure
// rather than "no proposals" or "nothing was proposed".

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
};
const goodList = { can_write: true, proposals: [], versions: [], people: [] };
const goodRoute = { route: { provider: "claude", model: "claude-sonnet-5-5" } };
const goodRun = {
    proposed: 1,
    discarded_quote_not_found: 2,
    discarded_duplicate: 0,
    discarded_invalid: 0,
    discarded_term_has_date: 1,
    proposal_ids: ["a"],
};
const goodProposal = { id: "a", status: "sent_to_legal" };
beforeEach(() => {
    fetchMock.mockReset();
    reply(goodList);
});

const P = "/api/projects/p%201/rule-proposals";
describe("rule proposals API", () => {
    it.each([
        ["list", () => getRuleProposals("p 1"), P, "GET", undefined, goodList],
        ["route", () => getRuleProposalRoute("p 1"), `${P}/route`, "GET", undefined, goodRoute],
        ["propose", () => proposeObligationRules("p 1", "v/1"), `${P}/versions/v%2F1/propose`, "POST", {}, goodRun],
        ["send to legal", () => decideRuleProposal("p 1", "a 1", "send-to-legal"), `${P}/a%201/send-to-legal`, "POST", {}, goodProposal],
        ["discard with a reason", () => decideRuleProposal("p 1", "a", "discard", { reason: "no" }), `${P}/a/discard`, "POST", { reason: "no" }, goodProposal],
        ["implemented with a code", () => decideRuleProposal("p 1", "a", "implemented", { catalog_code: "x.y" }), `${P}/a/implemented`, "POST", { catalog_code: "x.y" }, goodProposal],
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
        reply(goodList);
        expect(await getRuleProposals("p")).toEqual(goodList);
        reply(goodRoute);
        expect(await getRuleProposalRoute("p")).toEqual(goodRoute.route);
        reply({ route: null });
        expect(await getRuleProposalRoute("p")).toBeNull();
        reply(goodRun);
        expect(await proposeObligationRules("p", "v")).toEqual(goodRun);
        reply(goodProposal);
        expect(await decideRuleProposal("p", "a", "discard")).toEqual(goodProposal);
    });

    it("downloads the file for legal as a blob with the server's file name", async () => {
        fetchMock.mockImplementation(
            async () =>
                new Response("# LiTT", {
                    status: 200,
                    headers: { "content-disposition": 'attachment; filename="propuestas-reglas-leyes-20261119.md"' },
                }),
        );
        const file = await downloadRuleProposals("p 1");
        expect(fetchMock.mock.calls[0][0]).toBe(`${P}/export`);
        expect(file.filename).toBe("propuestas-reglas-leyes-20261119.md");
        expect(await file.blob.text()).toBe("# LiTT");
        fetchMock.mockImplementation(async () => new Response("x", { status: 200 }));
        expect((await downloadRuleProposals("p")).filename).toBeNull();
    });

    it.each([
        [null],
        [{}],
        [[]],
        [{ ...goodList, can_write: "yes" }],
        [{ ...goodList, can_write: undefined }],
        [{ ...goodList, proposals: {} }],
        [{ ...goodList, versions: null }],
        [{ ...goodList, people: undefined }],
    ])("treats %j as a failed list load", async (body) => {
        reply(body);
        await expect(getRuleProposals("p")).rejects.toThrow("Malformed");
    });

    it.each([[null], [{}], [{ route: {} }], [{ route: { provider: "claude" } }], [{ route: { provider: 1, model: "m" } }], [{ route: { provider: "claude", model: 5 } }]])(
        "treats %j as a failed route load",
        async (body) => {
            reply(body);
            await expect(getRuleProposalRoute("p")).rejects.toThrow("Malformed");
        },
    );

    it.each([
        [null],
        [{}],
        [{ ...goodRun, proposed: "1" }],
        [{ ...goodRun, discarded_quote_not_found: undefined }],
        [{ ...goodRun, discarded_duplicate: -1 }],
        [{ ...goodRun, discarded_invalid: 1.5 }],
        [{ ...goodRun, discarded_term_has_date: null }],
        [{ ...goodRun, proposed: Number.NaN }],
        [{ ...goodRun, proposal_ids: "a" }],
        [{ ...goodRun, proposal_ids: [1] }],
    ])("treats %j as a failed run", async (body) => {
        reply(body);
        await expect(proposeObligationRules("p", "v")).rejects.toThrow("Malformed");
    });

    it.each([[null], [{}], [{ id: "a" }], [{ id: 5, status: "pending" }], [{ id: "a", status: 5 }]])("treats %j as a failed decision", async (body) => {
        reply(body);
        await expect(decideRuleProposal("p", "a", "send-to-legal")).rejects.toThrow("Malformed");
    });
});

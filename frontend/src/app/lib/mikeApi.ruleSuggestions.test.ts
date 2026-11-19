import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    decideRuleSuggestion,
    decideRuleSuggestions,
    getRuleSuggestionRoute,
    getRuleSuggestions,
    planRuleRead,
    readRuleBatch,
    answerRuleQuestion,
    suggestObligationRules,
} from "./mikeApi";

// The rule suggestion calls (docs/obligation-rules.md): route, method and body,
// identifiers encoded, and a malformed reply is a failure rather than "no
// suggestions" or "nothing was suggested".

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
};
const goodList = { retainer: true, can_write: true, suggestions: [], versions: [], questions: [], people: [] };
const goodRoute = { route: { provider: "claude", model: "claude-sonnet-5-5" } };
const goodRun = {
    suggested: 1,
    discarded_unknown_rule: 0,
    discarded_already_active: 0,
    discarded_quote_not_found: 2,
    discarded_duplicate: 0,
    discarded_invalid: 0,
    suggestion_ids: ["s1"],
};
const goodPlan = {
    max_chars: 120000,
    batches: [{ chars: 10, documents: [{ version_id: "v1", document_id: "d1", version_number: 1, filename: "a.pdf", chars: 10 }] }],
    skipped: [{ version_id: "v2", version_number: 1, filename: "b.pdf", reason: "too_long" }],
};
const goodRead = { ...goodRun, questions_asked: 2, discarded_question_invalid: 0, superseded: 1 };
const goodAnswer = { question_id: "q1", answer: "yes", suggestion: { id: "s1" } };
const goodSuggestion = { id: "s1", rule_key: "lgsm.asamblea_ordinaria_anual@1", status: "accepted" };
const goodBatch = { results: [{ suggestion_id: "s1", outcome: "ok" }] };
beforeEach(() => {
    fetchMock.mockReset();
    reply(goodList);
});

const S = "/api/projects/p%201/matters/m%201/radar/rules/suggestions";
describe("rule suggestions API", () => {
    it.each([
        ["list", () => getRuleSuggestions("p 1", "m 1"), S, "GET", undefined, goodList],
        ["route", () => getRuleSuggestionRoute("p 1", "m 1"), `${S}/route`, "GET", undefined, goodRoute],
        ["suggest", () => suggestObligationRules("p 1", "m 1", "v/1"), `${S}/versions/v%2F1/suggest`, "POST", {}, goodRun],
        ["accept", () => decideRuleSuggestion("p 1", "m 1", "s 1", "accept"), `${S}/s%201/accept`, "POST", {}, goodSuggestion],
        ["discard with a reason", () => decideRuleSuggestion("p 1", "m 1", "s1", "discard", { reason: "no" }), `${S}/s1/discard`, "POST", { reason: "no" }, goodSuggestion],
        ["plan all", () => planRuleRead("p 1", "m 1"), `${S}/plan`, "POST", {}, goodPlan],
        ["plan a selection", () => planRuleRead("p 1", "m 1", ["v1", "v2"]), `${S}/plan`, "POST", { versionIds: ["v1", "v2"] }, goodPlan],
        ["read one call", () => readRuleBatch("p 1", "m 1", { runId: "r", versionIds: ["v1"] }), `${S}/read`, "POST", { runId: "r", versionIds: ["v1"] }, goodRead],
        ["answer yes", () => answerRuleQuestion("p 1", "m 1", "q/1", "yes"), `${S}/questions/q%2F1/answer`, "POST", { answer: "yes" }, goodAnswer],
        ["batch", () => decideRuleSuggestions("p 1", "m 1", { action: "accept", suggestionIds: ["a", "b"] }), `${S}/batch`, "POST", { action: "accept", suggestionIds: ["a", "b"] }, goodBatch],
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
        expect(await getRuleSuggestions("p", "m")).toEqual(goodList);
        reply(goodRoute);
        expect(await getRuleSuggestionRoute("p", "m")).toEqual(goodRoute.route);
        reply({ route: null });
        expect(await getRuleSuggestionRoute("p", "m")).toBeNull();
        reply(goodRun);
        expect(await suggestObligationRules("p", "m", "v")).toEqual(goodRun);
        reply(goodSuggestion);
        expect(await decideRuleSuggestion("p", "m", "s", "accept")).toEqual(goodSuggestion);
        reply(goodBatch);
        expect(await decideRuleSuggestions("p", "m", { action: "discard", suggestionIds: ["s1"] })).toEqual(goodBatch);
    });

    it.each([
        [null],
        [{}],
        [[]],
        [{ ...goodList, retainer: "yes" }],
        [{ ...goodList, can_write: undefined }],
        [{ ...goodList, suggestions: {} }],
        [{ ...goodList, versions: null }],
        [{ ...goodList, questions: undefined }],
        [{ ...goodList, questions: {} }],
        [{ ...goodList, people: undefined }],
    ])("treats %j as a failed list load", async (body) => {
        reply(body);
        await expect(getRuleSuggestions("p", "m")).rejects.toThrow("Malformed");
    });

    it.each([[null], [{}], [{ route: {} }], [{ route: { provider: "claude" } }], [{ route: { provider: 1, model: "m" } }], [{ route: { provider: "claude", model: 5 } }]])(
        "treats %j as a failed route load",
        async (body) => {
            reply(body);
            await expect(getRuleSuggestionRoute("p", "m")).rejects.toThrow("Malformed");
        },
    );

    it.each([
        [null],
        [{}],
        [{ ...goodRun, suggested: "1" }],
        [{ ...goodRun, discarded_unknown_rule: undefined }],
        [{ ...goodRun, discarded_already_active: -1 }],
        [{ ...goodRun, discarded_quote_not_found: 1.5 }],
        [{ ...goodRun, discarded_duplicate: null }],
        [{ ...goodRun, discarded_invalid: Number.NaN }],
        [{ ...goodRun, suggestion_ids: "s1" }],
        [{ ...goodRun, suggestion_ids: [1] }],
    ])("treats %j as a failed run", async (body) => {
        reply(body);
        await expect(suggestObligationRules("p", "m", "v")).rejects.toThrow("Malformed");
    });

    it.each([[null], [{}], [{ id: "s", rule_key: "k" }], [{ id: 5, rule_key: "k", status: "pending" }], [{ id: "s", rule_key: 5, status: "pending" }]])(
        "treats %j as a failed decision",
        async (body) => {
            reply(body);
            await expect(decideRuleSuggestion("p", "m", "s", "accept")).rejects.toThrow("Malformed");
        },
    );

    it.each([[null], [{}], [{ results: "ok" }]])("treats %j as a failed batch", async (body) => {
        reply(body);
        await expect(decideRuleSuggestions("p", "m", { action: "accept", suggestionIds: ["s"] })).rejects.toThrow("Malformed");
    });
});


describe("S8c: read all documents and questions", () => {
    it("returns what the server answered", async () => {
        reply(goodPlan);
        expect(await planRuleRead("p", "m")).toEqual(goodPlan);
        reply({ max_chars: 120000, batches: [], skipped: [] });
        expect((await planRuleRead("p", "m")).batches).toEqual([]);
        reply(goodRead);
        expect(await readRuleBatch("p", "m", { runId: "r", versionIds: ["v1"] })).toEqual(goodRead);
        reply(goodAnswer);
        expect(await answerRuleQuestion("p", "m", "q", "yes")).toEqual(goodAnswer);
        const no = { question_id: "q1", answer: "no", suggestion: null };
        reply(no);
        expect(await answerRuleQuestion("p", "m", "q", "no")).toEqual(no);
    });

    it.each([
        [null],
        [{}],
        [{ ...goodPlan, max_chars: "x" }],
        [{ ...goodPlan, batches: {} }],
        [{ ...goodPlan, batches: [null] }],
        [{ ...goodPlan, batches: [{ chars: 1, documents: "x" }] }],
        [{ ...goodPlan, batches: [{ chars: -1, documents: [] }] }],
        [{ ...goodPlan, batches: [{ chars: 1, documents: [{ version_id: 1, chars: 1 }] }] }],
        [{ ...goodPlan, batches: [{ chars: 1, documents: [{ version_id: "v", chars: "1" }] }] }],
        [{ ...goodPlan, skipped: "x" }],
        [{ ...goodPlan, skipped: [{ version_id: "v", reason: "other" }] }],
        [{ ...goodPlan, skipped: [{ version_id: 3, reason: "no_text" }] }],
    ])("treats %j as a failed plan", async (body) => {
        reply(body);
        await expect(planRuleRead("p", "m")).rejects.toThrow("Malformed");
    });

    it.each([
        [null],
        [{}],
        [{ ...goodRead, questions_asked: undefined }],
        [{ ...goodRead, discarded_question_invalid: "0" }],
        [{ ...goodRead, superseded: -1 }],
        [{ ...goodRead, suggested: 1.5 }],
        [{ ...goodRead, suggestion_ids: "s" }],
        [{ ...goodRead, suggestion_ids: [1] }],
    ])("treats %j as a failed read", async (body) => {
        reply(body);
        await expect(readRuleBatch("p", "m", { runId: "r", versionIds: ["v"] })).rejects.toThrow("Malformed");
    });

    it.each([
        [null],
        [{}],
        [{ question_id: 1, answer: "yes", suggestion: null }],
        [{ question_id: "q", answer: "maybe", suggestion: null }],
        [{ question_id: "q", answer: "yes" }],
        [{ question_id: "q", answer: "yes", suggestion: {} }],
        [{ question_id: "q", answer: "no", suggestion: { id: "s" } }],
    ])("treats %j as a failed answer", async (body) => {
        reply(body);
        await expect(answerRuleQuestion("p", "m", "q", "yes")).rejects.toThrow("Malformed");
    });
});

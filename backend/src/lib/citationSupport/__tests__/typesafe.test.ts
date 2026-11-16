import { describe, expect, it, vi } from "vitest";
import {
    askCitationSupport,
    CitationSupportError,
    JEV_MODEL,
    QUESTION_VERSION,
    SUPPORT_QUESTION,
    supportBand,
    TYPESAFE_URL,
} from "../typesafe";

// The real TypeSafe API is never called: fetch is a mock.
const SECRET = "synthetic-typesafe-key-0001";
const STATE = {
    afirmacion: "El plazo es de 30 días.",
    cita: "El plazo será de 30 (treinta) días naturales.",
    contexto: "Tercera. El plazo será de 30 (treinta) días naturales.",
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const answer = (p: unknown, extra: Record<string, unknown> = {}) =>
    json(200, {
        model: JEV_MODEL,
        answers: { respalda: { type: "noul", noul: p } },
        usage: { input_tokens: 975, output_tokens: 12 },
        ...extra,
    });

const deps = (fetchImpl: ReturnType<typeof vi.fn>, sleep = vi.fn(async () => undefined)) => ({
    fetch: fetchImpl as unknown as typeof fetch,
    sleep,
});

describe("the request", () => {
    it("is one Noul question to the fixed host, on the pinned model, with the key only in the header", async () => {
        const fetchImpl = vi.fn(async () => answer(0.9));
        await askCitationSupport(SECRET, STATE, deps(fetchImpl));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(TYPESAFE_URL);
        expect(url).toBe("https://api.typesafe.ai/v1/systemone");
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("manual");
        expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe("jev-1.14.0");
        expect(JEV_MODEL).toBe("jev-1.14.0");
        expect(body.state).toEqual(STATE);
        expect(Object.keys(body.questions)).toEqual(["respalda"]);
        expect(body.questions.respalda).toEqual(JSON.parse(JSON.stringify(SUPPORT_QUESTION)));
        expect(body.questions.respalda.type).toBe("noul");
        expect(body.questions.respalda.instructions.question).toContain("respalda por completo la `afirmacion`");
        expect(body.questions.respalda.criteria.true.what).toBeTruthy();
        expect(body.questions.respalda.criteria.false.examples.length).toBe(5);
        // The key is in the header and nowhere else.
        expect(init.body as string).not.toContain(SECRET);
        expect(QUESTION_VERSION).toBe("noul-rico-v2");
    });

    it("identifies neither the firm nor the person: only the key, the model, the state and the question", async () => {
        const fetchImpl = vi.fn(async () => answer(0.9));
        await askCitationSupport(SECRET, STATE, deps(fetchImpl));
        const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(Object.keys(init.headers as object).sort()).toEqual(["accept", "authorization", "content-type"]);
        const body = JSON.parse(init.body as string);
        expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
        expect(Object.keys(body.state).sort()).toEqual(["afirmacion", "cita", "contexto"]);
    });

    it("returns the probability, the model that answered, the latency and the tokens", async () => {
        const times = [1_000, 1_130];
        const result = await askCitationSupport(SECRET, STATE, {
            ...deps(vi.fn(async () => answer(0.42))),
            now: () => times.shift() ?? 0,
        });
        expect(result).toEqual({ probability: 0.42, model: "jev-1.14.0", latencyMs: 130, inputTokens: 975 });
    });
});

describe("the bands", () => {
    it.each([
        [0, "not_supported"],
        [0.29, "not_supported"],
        [0.3, "review"],
        [0.5, "review"],
        [0.69, "review"],
        [0.7, "supported"],
        [1, "supported"],
    ] as const)("p = %s is %s", (p, band) => {
        expect(supportBand(p)).toBe(band);
    });
});

describe("errors", () => {
    it.each([
        [401, "unauthorized"],
        [402, "payment_required"],
        [403, "forbidden"],
    ] as const)("%s is never retried", async (status, code) => {
        const fetchImpl = vi.fn(async () => json(status, { detail: "text with the claim and " + SECRET }));
        const sleep = vi.fn(async () => undefined);
        const error = await askCitationSupport(SECRET, STATE, deps(fetchImpl, sleep)).catch((e) => e);
        expect(error).toBeInstanceOf(CitationSupportError);
        expect(error.code).toBe(code);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it.each([429, 500, 503, 529])("%s is retried once after a wait, then succeeds", async (status) => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(json(status, {}, { "retry-after": "2" }))
            .mockResolvedValueOnce(answer(0.8));
        const sleep = vi.fn(async () => undefined);
        const result = await askCitationSupport(SECRET, STATE, deps(fetchImpl, sleep));
        expect(result.probability).toBe(0.8);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(2_000);
    });

    it("waits one second without a Retry-After and caps a long one", async () => {
        const sleep = vi.fn(async () => undefined);
        await askCitationSupport(
            SECRET,
            STATE,
            deps(vi.fn().mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(answer(0.8)), sleep),
        );
        await askCitationSupport(
            SECRET,
            STATE,
            deps(vi.fn().mockResolvedValueOnce(json(503, {}, { "retry-after": "600" })).mockResolvedValueOnce(answer(0.8)), sleep),
        );
        expect(sleep.mock.calls).toEqual([[1_000], [5_000]]);
    });

    it("gives up after the one retry", async () => {
        const fetchImpl = vi.fn(async () => json(429, {}));
        const error = await askCitationSupport(SECRET, STATE, deps(fetchImpl)).catch((e) => e);
        expect(error.code).toBe("rate_limited");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const unavailable = vi.fn(async () => json(502, {}));
        expect((await askCitationSupport(SECRET, STATE, deps(unavailable)).catch((e) => e)).code).toBe("unavailable");
        expect(unavailable).toHaveBeenCalledTimes(2);
    });

    it.each([400, 413, 422])("%s is rejected without a retry", async (status) => {
        const fetchImpl = vi.fn(async () => json(status, {}));
        const error = await askCitationSupport(SECRET, STATE, deps(fetchImpl)).catch((e) => e);
        expect(error.code).toBe("rejected");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("refuses a redirect instead of following it", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
        const error = await askCitationSupport(SECRET, STATE, deps(fetchImpl)).catch((e) => e);
        expect(error.code).toBe("rejected");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("treats a network failure as network, without retrying", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error(`connect ECONNREFUSED while sending ${SECRET}`);
        });
        const error = await askCitationSupport(SECRET, STATE, deps(fetchImpl)).catch((e) => e);
        expect(error.code).toBe("network");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["no answers", { model: JEV_MODEL, usage: {} }],
        ["a different type", { model: JEV_MODEL, answers: { respalda: { type: "choice", choice: "x" } } }],
        ["a probability above 1", { model: JEV_MODEL, answers: { respalda: { type: "noul", noul: 1.2 } } }],
        ["a text probability", { model: JEV_MODEL, answers: { respalda: { type: "noul", noul: "0.9" } } }],
        ["no model", { answers: { respalda: { type: "noul", noul: 0.9 } } }],
    ])("rejects a 200 with %s", async (_name, body) => {
        const error = await askCitationSupport(SECRET, STATE, deps(vi.fn(async () => json(200, body)))).catch((e) => e);
        expect(error.code).toBe("bad_response");
    });

    it("rejects an empty key before sending anything", async () => {
        const fetchImpl = vi.fn();
        const error = await askCitationSupport("  ", STATE, deps(fetchImpl)).catch((e) => e);
        expect(error.code).toBe("unauthorized");
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("never puts the key, the claim, the quote or the response text in an error", async () => {
        const hostile = `${SECRET} ${STATE.afirmacion} ${STATE.cita}`;
        for (const status of [401, 500, 400]) {
            const error = await askCitationSupport(
                SECRET,
                STATE,
                deps(vi.fn(async () => json(status, { detail: hostile }))),
            ).catch((e) => e);
            const shown = JSON.stringify({ message: error.message, stack: error.stack, own: { ...error } });
            expect(shown).not.toContain(SECRET);
            expect(shown).not.toContain("30 días");
        }
        const thrown = await askCitationSupport(
            SECRET,
            STATE,
            deps(vi.fn(async () => { throw new Error(hostile); })),
        ).catch((e) => e);
        expect(`${thrown.message}${thrown.stack}${JSON.stringify(thrown)}`).not.toContain(SECRET);
        expect(String((thrown as Error & { cause?: unknown }).cause ?? "")).not.toContain(SECRET);
    });
});

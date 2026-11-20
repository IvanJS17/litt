import { describe, expect, it, vi } from "vitest";
import {
    askJev,
    choiceQuestion,
    JEV_MODEL,
    JEV_URL,
    JevError,
    noulQuestion,
    readChoice,
    readNoul,
    readScore,
    scoreQuestion,
} from "../jev";

// The real TypeSafe API is never called: fetch is a mock, answering as
// https://docs.typesafe.ai/api/system-one.md documents.
const SECRET = "synthetic-typesafe-key-0002";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const QUESTIONS = {
    tipo: choiceQuestion("¿Qué tipo?", { tipo_1: "Contratos", tipo_2: "Otro" }),
    tipo_aplica: noulQuestion("¿Alguno aplica?"),
    urgencia: scoreQuestion("¿Qué tan urgente?", ["Puede esperar", "Esta semana", "Hoy"]),
};
const ANSWERS = {
    model: JEV_MODEL,
    answers: {
        tipo: { type: "choice", choice: "tipo_2", confidence: 0.9, probabilities: { tipo_1: 0.1, tipo_2: 0.9 } },
        tipo_aplica: { type: "noul", noul: 0.95 },
        urgencia: { type: "score", score: 1.7, confidence: 0.55, legend: {}, probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 } },
    },
    usage: { input_tokens: 2_000, output_tokens: 40 },
};
const deps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: vi.fn(async () => undefined),
});

describe("the request", () => {
    it("is one POST to the fixed host, on the pinned model, with the key only in the header and no redirects", async () => {
        const fetchImpl = vi.fn(async () => json(200, ANSWERS));
        await askJev(SECRET, { state: { titulo: "Contrato" }, questions: QUESTIONS }, deps(fetchImpl));
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(JEV_URL);
        expect(url).toBe("https://api.typesafe.ai/v1/systemone");
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("manual");
        expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
        expect(init.body as string).not.toContain(SECRET);
        expect(JSON.parse(init.body as string)).toEqual({
            model: "jev-1.14.0",
            state: { titulo: "Contrato" },
            questions: {
                tipo: { type: "choice", instructions: "¿Qué tipo?", criteria: { tipo_1: "Contratos", tipo_2: "Otro" } },
                tipo_aplica: { type: "noul", instructions: "¿Alguno aplica?" },
                urgencia: { type: "score", instructions: "¿Qué tan urgente?", criteria: ["Puede esperar", "Esta semana", "Hoy"] },
            },
        });
    });
});

describe("the answers", () => {
    it("reads choice, score and noul, and the tokens it was billed for", async () => {
        const response = await askJev(SECRET, { state: "x", questions: QUESTIONS }, deps(vi.fn(async () => json(200, ANSWERS))));
        expect(response.model).toBe(JEV_MODEL);
        expect(response.inputTokens).toBe(2_000);
        expect(response.outputTokens).toBe(40);
        expect(readChoice(response.answers, "tipo", ["tipo_1", "tipo_2"])).toEqual({ choice: "tipo_2", probability: 0.9, confidence: 0.9 });
        expect(readNoul(response.answers, "tipo_aplica")).toBe(0.95);
        expect(readScore(response.answers, "urgencia", 3)).toEqual({ score: 1.7, confidence: 0.55 });
    });

    it("treats a choice outside the options, a missing answer and a wrong type as absent, never as a guess", () => {
        const answers = {
            tipo: { type: "choice", choice: "inventada", probabilities: { inventada: 1 } },
            urgencia: { type: "noul", noul: 0.5 },
            fuera: { type: "score", score: 7 },
        };
        expect(readChoice(answers, "tipo", ["tipo_1"])).toBeNull();
        expect(readChoice(answers, "nada", ["tipo_1"])).toBeNull();
        expect(readScore(answers, "urgencia", 3)).toBeNull();
        expect(readScore(answers, "fuera", 3)).toBeNull();
        expect(readNoul({ a: { type: "noul", noul: 1.5 } }, "a")).toBeNull();
    });
});

describe("failures", () => {
    const code = async (status: number, headers: Record<string, string> = {}) => {
        const fetchImpl = vi.fn(async () => json(status, { error: "SECRET BODY" }, headers));
        const error = await askJev(SECRET, { state: "x", questions: QUESTIONS }, deps(fetchImpl)).catch((e) => e);
        return { error, calls: fetchImpl.mock.calls.length };
    };

    it("names 401, 402 and 403 and never retries them", async () => {
        for (const [status, expected] of [[401, "unauthorized"], [402, "payment_required"], [403, "forbidden"], [400, "rejected"]] as const) {
            const { error, calls } = await code(status);
            expect(error).toBeInstanceOf(JevError);
            expect(error.code).toBe(expected);
            expect(calls).toBe(1);
        }
    });

    it("retries 429 and 5xx once, then gives up with a static message", async () => {
        for (const [status, expected] of [[429, "rate_limited"], [503, "unavailable"], [529, "unavailable"]] as const) {
            const { error, calls } = await code(status, { "retry-after": "1" });
            expect(error.code).toBe(expected);
            expect(calls).toBe(2);
            expect(error.message).not.toContain("SECRET");
            expect(error.message).not.toContain(SECRET);
        }
    });

    it("is a network error on a thrown fetch and a bad response on an answer it cannot read", async () => {
        const down = await askJev(SECRET, { state: "x", questions: QUESTIONS }, deps(vi.fn(async () => { throw new Error(SECRET); }))).catch((e) => e);
        expect(down.code).toBe("network");
        expect(down.message).not.toContain(SECRET);
        for (const body of [{}, { model: "m" }, { model: "m", answers: [] }, { answers: {} }]) {
            const bad = await askJev(SECRET, { state: "x", questions: QUESTIONS }, deps(vi.fn(async () => json(200, body)))).catch((e) => e);
            expect(bad.code).toBe("bad_response");
        }
    });

    it("refuses an empty key without calling out", async () => {
        const fetchImpl = vi.fn();
        const error = await askJev("  ", { state: "x", questions: QUESTIONS }, deps(fetchImpl)).catch((e) => e);
        expect(error.code).toBe("unauthorized");
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

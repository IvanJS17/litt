// Jev (TypeSafe System One): POST https://api.typesafe.ai/v1/systemone
// https://docs.typesafe.ai/api/system-one.md
//
// The one client for every question LiTT asks Jev: the citation check
// (a Noul) and Donna's triage of a request (Choice and
// Score, with a companion Noul). One endpoint, one platform key, one pinned
// model; what changes between callers is the question.
//
// The key is the platform's (TYPESAFE_API_KEY; there are no per-user or
// per-firm keys) and travels only in the Authorization header to the one fixed
// host below. Redirects are refused so the header cannot follow one to another
// origin. Neither the key, the state nor TypeSafe's response text appears in a
// message or a log: every failure is a static code (JevError.code).
import { AppError } from "./appError";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
/** A versioned id, never `jev-latest`: aliases move and the thresholds were measured on this one. */
export const JEV_MODEL = "jev-1.14.0";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_WAIT_MS = 1_000;
const MAX_RETRY_WAIT_MS = 5_000;

export type JevErrorCode =
    | "unauthorized" // 401
    | "payment_required" // 402
    | "forbidden" // 403
    | "rate_limited" // 429, after the one retry
    | "unavailable" // 5xx and 529, after the one retry
    | "rejected" // any other 4xx: the request itself was refused
    | "network" // timeout, abort or connection failure
    | "bad_response"; // 200 without a usable answer

export class JevError extends AppError {
    readonly code: JevErrorCode;
    readonly status: number | null;
    constructor(code: JevErrorCode, status: number | null = null) {
        super("jev.error", `Jev request failed: ${code}`);
        this.code = code;
        this.status = status;
    }
}

export type JevDeps = {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
};

export type JevQuestion = Record<string, unknown>;

/** What Jev answered: the model that did, every answer by question name, the tokens billed. */
export type JevResponse = {
    model: string;
    answers: Record<string, unknown>;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

/** The platform's TypeSafe key, or null. Never log it. */
export function jevApiKey(): string | null {
    return process.env.TYPESAFE_API_KEY?.trim() || null;
}

// ---- Question builders ---------------------------------------------------

/** Pick one of `criteria` (option name -> description). */
export function choiceQuestion(instructions: unknown, criteria: Record<string, unknown>): JevQuestion {
    return { type: "choice", instructions, criteria };
}

/** A position on ordered `criteria` (1 to 10 level descriptions, low to high). */
export function scoreQuestion(instructions: unknown, criteria: unknown[]): JevQuestion {
    return { type: "score", instructions, criteria };
}

/** A yes/no: the probability of yes. */
export function noulQuestion(instructions: unknown, criteria?: unknown): JevQuestion {
    return { type: "noul", instructions, ...(criteria === undefined ? {} : { criteria }) };
}

// ---- Answer readers (null = absent or malformed, never a guess) -----------

export type ChoiceAnswer = { choice: string; probability: number; confidence: number | null };

export function readChoice(answers: Record<string, unknown>, name: string, options: readonly string[]): ChoiceAnswer | null {
    const answer = answers[name];
    if (!isRecord(answer) || answer.type !== "choice") return null;
    const choice = answer.choice;
    if (typeof choice !== "string" || !options.includes(choice)) return null;
    const probabilities = answer.probabilities;
    const probability = isRecord(probabilities) ? probabilities[choice] : undefined;
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : null;
    return { choice, probability, confidence };
}

export type ScoreAnswer = { score: number; confidence: number | null };

export function readScore(answers: Record<string, unknown>, name: string, levels: number): ScoreAnswer | null {
    const answer = answers[name];
    if (!isRecord(answer) || answer.type !== "score") return null;
    const score = answer.score;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > levels - 1) return null;
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : null;
    return { score, confidence };
}

export function readNoul(answers: Record<string, unknown>, name: string): number | null {
    const answer = answers[name];
    if (!isRecord(answer) || answer.type !== "noul") return null;
    const probability = answer.noul;
    return typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1
        ? probability
        : null;
}

// ---- Transport ------------------------------------------------------------

function statusError(status: number): JevError {
    if (status === 401) return new JevError("unauthorized", status);
    if (status === 402) return new JevError("payment_required", status);
    if (status === 403) return new JevError("forbidden", status);
    if (status === 429) return new JevError("rate_limited", status);
    if (status >= 500) return new JevError("unavailable", status);
    return new JevError("rejected", status);
}

/** Seconds in Retry-After, capped; otherwise a short fixed wait. */
function retryWait(response: Response): number {
    const seconds = Number(response.headers.get("retry-after"));
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1_000, MAX_RETRY_WAIT_MS) : RETRY_WAIT_MS;
}

/**
 * Ask Jev `questions` about `state`. 401, 402 and 403 are never retried; 429
 * and 5xx are retried once after a wait. Every failure is a JevError with a
 * static message.
 */
export async function askJev(
    apiKey: string,
    request: { state: unknown; questions: Record<string, JevQuestion> },
    deps: JevDeps = {},
): Promise<JevResponse> {
    const doFetch = deps.fetch ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const now = deps.now ?? (() => performance.now());
    const key = apiKey.trim();
    if (!key) throw new JevError("unauthorized");
    const body = JSON.stringify({ model: JEV_MODEL, state: request.state, questions: request.questions });

    for (let attempt = 0; ; attempt += 1) {
        const started = now();
        let response: Response;
        try {
            response = await doFetch(JEV_URL, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${key}`,
                    "content-type": "application/json",
                    accept: "application/json",
                },
                body,
                // The key rides in a header, and fetch forwards custom headers
                // across origins on a redirect. TypeSafe needs none.
                redirect: "manual",
                signal: AbortSignal.any([
                    ...(deps.signal ? [deps.signal] : []),
                    AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
                ]),
            });
        } catch {
            throw new JevError("network");
        }
        if (response.status !== 200) {
            await response.body?.cancel().catch(() => undefined);
            const error = statusError(response.status);
            const retryable = error.code === "rate_limited" || error.code === "unavailable";
            if (!retryable || attempt >= 1) throw error;
            await sleep(retryWait(response));
            continue;
        }
        let json: unknown;
        try {
            json = await response.json();
        } catch {
            throw new JevError("bad_response");
        }
        const latencyMs = Math.max(0, Math.round(now() - started));
        return parseResponse(json, latencyMs);
    }
}

function tokenCount(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseResponse(json: unknown, latencyMs: number): JevResponse {
    if (!isRecord(json) || !isRecord(json.answers) || typeof json.model !== "string" || !json.model)
        throw new JevError("bad_response");
    const usage = isRecord(json.usage) ? json.usage : null;
    return {
        model: json.model.slice(0, 80),
        answers: json.answers,
        inputTokens: tokenCount(usage?.input_tokens),
        outputTokens: tokenCount(usage?.output_tokens),
        latencyMs,
    };
}

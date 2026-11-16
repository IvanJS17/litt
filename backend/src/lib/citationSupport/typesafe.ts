// TypeSafe (Jev, System One): POST https://api.typesafe.ai/v1/systemone
// https://docs.typesafe.ai/api/system-one.md
//
// Does the quote, read with its context, support the claim the answer made
// about it? One Noul question per citation, answered with the probability of
// "yes". The question, the thresholds and the pinned model come from the
// pilot of 2026-11-14 (192 test cases, 97.2 % of the bad citations marked,
// 0 of 50 good ones); changing any of them changes what the numbers mean, so
// QUESTION_VERSION changes with them.
//
// The key is the owner's own (never the platform's) and travels only in the
// Authorization header to the one fixed host below. Redirects are refused so
// the header cannot follow one to another origin. Neither the key, the claim,
// the quote nor TypeSafe's response text appears in a message or a log: every
// failure is a static code (CitationSupportError.code).
import { AppError } from "../appError";

export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
/** A versioned id, never `jev-latest`: aliases move and the bands were measured on this one. */
export const JEV_MODEL = "jev-1.14.0";
export const QUESTION_VERSION = "noul-rico-v2";
const QUESTION_NAME = "respalda";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_WAIT_MS = 1_000;
const MAX_RETRY_WAIT_MS = 5_000;

/** p < 0.3 not supported, 0.3 to 0.7 review, p >= 0.7 supported. */
export const NOT_SUPPORTED_BELOW = 0.3;
export const SUPPORTED_FROM = 0.7;

export type SupportBand = "not_supported" | "review" | "supported";

export function supportBand(probability: number): SupportBand {
    if (probability < NOT_SUPPORTED_BELOW) return "not_supported";
    if (probability < SUPPORTED_FROM) return "review";
    return "supported";
}

export type CitationSupportErrorCode =
    | "unauthorized" // 401
    | "payment_required" // 402
    | "forbidden" // 403
    | "rate_limited" // 429, after the one retry
    | "unavailable" // 5xx and 529, after the one retry
    | "rejected" // any other 4xx: the request itself was refused
    | "network" // timeout, abort or connection failure
    | "bad_response"; // 200 without a usable answer

/** Codes that no retry can fix: the key or the account has to change. */
export const KEY_ERROR_CODES: readonly CitationSupportErrorCode[] = [
    "unauthorized",
    "payment_required",
    "forbidden",
];

export class CitationSupportError extends AppError {
    readonly code: CitationSupportErrorCode;
    readonly status: number | null;
    constructor(code: CitationSupportErrorCode, status: number | null = null) {
        super("citation_support.typesafe_error", `Citation support check failed: ${code}`);
        this.code = code;
        this.status = status;
    }
}

/** What Jev reads: the answer's sentence, the quote and the text around it. */
export type SupportState = {
    afirmacion: string;
    cita: string;
    contexto: string;
};

/** The pilot's winning question (artifacts/typesafe-20261114/piloto/scripts/questions.py, NOUL_RICO_V2), verbatim. */
export const SUPPORT_QUESTION = {
    type: "noul",
    instructions: {
        question: "¿La `cita`, leída junto con su `contexto`, respalda por completo la `afirmacion`?",
        focus:
            "Revisa si la `afirmacion` agrega, cambia o amplía algo respecto de la `cita`: montos, plazos, fechas, " +
            "partes, obligaciones, condiciones, excepciones y alcance.",
        nota:
            "Que la afirmación resuma u omita detalles de la cita no importa, mientras lo que sí afirma esté dicho en la cita.",
    },
    criteria: {
        true: {
            what:
                "Lo que sostiene la afirmación está dicho o directamente implicado por la cita y su contexto; " +
                "puede ser una paráfrasis o un resumen más corto.",
            examples: [
                "Afirmación «el arrendatario paga $12,000 al mes» con cita «La renta mensual a cargo del Arrendatario será de $12,000.00»",
                "Afirmación «según el vendedor, hubo retrasos» con cita «el vendedor sostuvo que hubo retrasos»",
            ],
        },
        false: {
            what:
                "La cita contradice algún dato de la afirmación, trata de otro tema, o la afirmación dice más que la cita.",
            examples: [
                "Otro monto, plazo, fecha o parte que el de la cita",
                "La cita es de otra cláusula aunque comparta palabras o cifras",
                "La afirmación presenta como incondicional o general algo que la cita sujeta a una condición, excepción o límite",
                "«debe» donde la cita dice «puede», o una opción presentada como obligación",
                "Presentar como hecho o como reconocimiento lo que la cita atribuye como alegato de una de las Partes",
            ],
        },
    },
} as const;

export type SupportAnswer = {
    probability: number;
    /** The model that answered, as the response names it. */
    model: string;
    latencyMs: number;
    inputTokens: number | null;
};

export type SupportDeps = {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

function statusError(status: number): CitationSupportError {
    if (status === 401) return new CitationSupportError("unauthorized", status);
    if (status === 402) return new CitationSupportError("payment_required", status);
    if (status === 403) return new CitationSupportError("forbidden", status);
    if (status === 429) return new CitationSupportError("rate_limited", status);
    if (status >= 500) return new CitationSupportError("unavailable", status);
    return new CitationSupportError("rejected", status);
}

/** Seconds in Retry-After, capped; otherwise a short fixed wait. */
function retryWait(response: Response): number {
    const seconds = Number(response.headers.get("retry-after"));
    return Number.isFinite(seconds) && seconds > 0
        ? Math.min(seconds * 1_000, MAX_RETRY_WAIT_MS)
        : RETRY_WAIT_MS;
}

/**
 * Ask Jev whether `state.cita` supports `state.afirmacion`. 401, 402 and 403
 * are never retried; 429 and 5xx are retried once after a wait. Every
 * failure is a CitationSupportError with a static message.
 */
export async function askCitationSupport(
    apiKey: string,
    state: SupportState,
    deps: SupportDeps = {},
): Promise<SupportAnswer> {
    const doFetch = deps.fetch ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const now = deps.now ?? (() => performance.now());
    const key = apiKey.trim();
    if (!key) throw new CitationSupportError("unauthorized");
    const body = JSON.stringify({
        model: JEV_MODEL,
        state,
        questions: { [QUESTION_NAME]: SUPPORT_QUESTION },
    });

    for (let attempt = 0; ; attempt += 1) {
        const started = now();
        let response: Response;
        try {
            response = await doFetch(TYPESAFE_URL, {
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
            throw new CitationSupportError("network");
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
            throw new CitationSupportError("bad_response");
        }
        const latencyMs = Math.max(0, Math.round(now() - started));
        return parseAnswer(json, latencyMs);
    }
}

function parseAnswer(json: unknown, latencyMs: number): SupportAnswer {
    const answers = isRecord(json) && isRecord(json.answers) ? json.answers : null;
    const answer = answers && isRecord(answers[QUESTION_NAME]) ? answers[QUESTION_NAME] : null;
    const probability = answer && answer.type === "noul" ? answer.noul : null;
    const model = isRecord(json) ? json.model : null;
    if (
        typeof probability !== "number" ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1 ||
        typeof model !== "string" ||
        !model
    )
        throw new CitationSupportError("bad_response");
    const usage = isRecord(json) && isRecord(json.usage) ? json.usage : null;
    const tokens = usage?.input_tokens;
    return {
        probability,
        model: model.slice(0, 80),
        latencyMs,
        inputTokens: typeof tokens === "number" && Number.isInteger(tokens) && tokens >= 0 ? tokens : null,
    };
}

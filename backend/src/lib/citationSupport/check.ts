// Citation support check, silent mode (docs/citation-support-check.md).
//
// After an assistant answer with citations is saved, and only when the server
// switch LITT_CITATION_CHECK is `enabled`, the platform has a TYPESAFE_API_KEY
// the person has not opted out and has accepted the current LEGAL_VERSION, each citation is checked in the
// background: one request per citation, in parallel, and the result is
// written to citation_support_checks as numbers and references. Nothing is
// shown to the lawyer and nothing waits for it; a failure leaves one
// sanitized [report] and nothing else. The claim, the quote and its context
// live in memory for the length of the requests and are never stored.
import { AppError } from "../appError";
import { reportError } from "../observability/report";
import type { Db } from "../supabase";
import { citationCheckApiKey } from "../chatFeatureGates";
import { teamOrgIdOf } from "../personalOrgs";
import { citationCheckPermitted } from "./preference";
import type { CitationSupportInput } from "./inputs";
import {
    askCitationSupport,
    CitationSupportError,
    KEY_ERROR_CODES,
    QUESTION_VERSION,
    supportBand,
    type SupportDeps,
} from "./typesafe";

/** Requests in flight at once for one answer. */
const CONCURRENCY = 6;

export type CitationSupportScope = {
    /** The firm whose space the answer is in; null in a personal space. Counted, never sent. */
    orgId: string | null;
    /** The saved assistant message: a chat message, or a Word chat message. */
    messageId: string;
    surface: "chat" | "word";
};

export type CitationSupportOutcome = {
    checked: number;
    failed: number;
    /** The first failure's code, for the report; null when none failed. */
    firstFailure: string | null;
};

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Check every input and write the evidence. Never throws: a failure is
 * counted and reported. After a refused key (401, 402, 403) the remaining
 * citations of the answer are not sent.
 */
export async function runCitationSupportChecks(args: {
    db: Db;
    apiKey: string;
    scope: CitationSupportScope;
    inputs: readonly CitationSupportInput[];
    deps?: SupportDeps;
}): Promise<CitationSupportOutcome> {
    const outcome: CitationSupportOutcome = { checked: 0, failed: 0, firstFailure: null };
    const queue = [...args.inputs];
    let keyRefused = false;
    const fail = (code: string) => {
        outcome.failed += 1;
        outcome.firstFailure ??= code;
    };

    const worker = async () => {
        for (let input = queue.shift(); input; input = queue.shift()) {
            if (keyRefused) return;
            try {
                const answer = await askCitationSupport(args.apiKey, input.state, args.deps);
                const { error } = await args.db.from("citation_support_checks").insert({
                    organization_id: args.scope.orgId,
                    ...(args.scope.surface === "word"
                        ? { word_message_id: args.scope.messageId }
                        : { message_id: args.scope.messageId }),
                    citation_ref: input.ref,
                    document_id: input.documentId,
                    version_id: input.versionId,
                    start_char: input.startChar,
                    end_char: input.endChar,
                    probability: answer.probability,
                    band: supportBand(answer.probability),
                    model: answer.model,
                    question_version: QUESTION_VERSION,
                    latency_ms: answer.latencyMs,
                    input_tokens: answer.inputTokens,
                });
                // Already checked, or the answer was deleted while it ran.
                if (error && error.code !== UNIQUE_VIOLATION && error.code !== FOREIGN_KEY_VIOLATION) {
                    fail(`db_${error.code ?? "error"}`);
                    continue;
                }
                outcome.checked += 1;
            } catch (error) {
                if (error instanceof CitationSupportError) {
                    fail(error.code);
                    if (KEY_ERROR_CODES.includes(error.code)) keyRefused = true;
                } else fail("unexpected");
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
    );
    return outcome;
}

/** The sanitized line for a run that had failures: static text, a code and counts. */
function reportFailures(outcome: CitationSupportOutcome): void {
    reportError(
        new AppError(
            "citation_support.failed",
            `Citation support check had failures: ${outcome.firstFailure}`,
        ),
        {
            level: "warning",
            tags: {
                component: "citation-support",
                failure_code: outcome.firstFailure,
                failed: outcome.failed,
                checked: outcome.checked,
            },
        },
    );
}

/**
 * One answer's silent check. `create` returns null unless the space's TypeSafe
 * key is present and on, so a space without one runs no code of this
 * capability. `collect` goes to the engine, which hands it the inputs once the
 * citations are verified; `finish` runs after the answer is saved.
 */
export type CitationSupportTurn = {
    collect: (inputs: CitationSupportInput[]) => void;
    finish: (messageId: string | null | undefined, saved: boolean) => Promise<CitationSupportOutcome | null>;
};

/**
 * The check for one answer, or null when it does not exist for it: the server
 * switch is off, there is no platform key, the person opted out, or they have
 * not accepted the current legal version. Nothing
 * is read or sent in those cases.
 */
export async function createCitationSupportTurn(args: {
    db: Db;
    userId: string;
    /** The conversation's organization (a personal organization counts as none). */
    orgId: string | null | undefined;
    surface: "chat" | "word";
    /** The current LEGAL_VERSION: only people who accepted it are ever sent. */
    legalVersion: string;
    deps?: SupportDeps;
}): Promise<CitationSupportTurn | null> {
    const apiKey = citationCheckApiKey();
    if (!apiKey) return null;
    try {
        if (!(await citationCheckPermitted(args.db, args.userId, args.legalVersion))) return null;
    } catch {
        return null; // Silent mode: a failed preference read is "no check".
    }
    let inputs: CitationSupportInput[] = [];
    return {
        collect: (collected) => {
            inputs = collected;
        },
        // Detached from the turn: the caller does not await it.
        finish: async (messageId, saved) => {
            if (!saved || !messageId || !inputs.length) return null;
            try {
                const outcome = await runCitationSupportChecks({
                    db: args.db,
                    apiKey,
                    scope: {
                        orgId: await teamOrgIdOf(args.db, args.orgId),
                        messageId,
                        surface: args.surface,
                    },
                    inputs,
                    deps: args.deps,
                });
                if (outcome.failed) reportFailures(outcome);
                return outcome;
            } catch {
                reportFailures({ checked: 0, failed: 1, firstFailure: "unexpected" });
                return null;
            }
        },
    };
}

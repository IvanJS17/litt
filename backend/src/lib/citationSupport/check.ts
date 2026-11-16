// Citation support check, silent mode (docs/citation-support-check.md).
//
// After an assistant answer with citations (a chat answer, a tabular review
// cell, a tabular chat answer or a playbook draft) is saved, and only when the server
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

/**
 * Where a result is kept: the row it belongs to. One surface per path, each
 * with its own owner column in citation_support_checks; the result is deleted
 * with that row.
 */
export type CitationSupportSurface = "chat" | "word" | "tabular_cell" | "tabular_chat" | "playbook";

const OWNER_COLUMN: Record<CitationSupportSurface, string> = {
    chat: "message_id",
    word: "word_message_id",
    tabular_cell: "tabular_cell_id",
    tabular_chat: "tabular_chat_message_id",
    playbook: "playbook_id",
};

export type CitationSupportScope = {
    /** The firm whose space the answer is in; null in a personal space. Counted, never sent. */
    orgId: string | null;
    /** The saved row the results belong to: the message, cell or playbook of `surface`. */
    ownerId: string;
    surface: CitationSupportSurface;
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

    // A tabular cell is regenerated in place: the check of its previous
    // content goes before the new one is written, so no stale result stays.
    if (args.scope.surface === "tabular_cell" && queue.length) {
        try {
            await args.db
                .from("citation_support_checks")
                .delete()
                .eq(OWNER_COLUMN.tabular_cell, args.scope.ownerId);
        } catch {
            // The unique index then keeps the older result; nothing else is affected.
        }
    }

    const worker = async () => {
        for (let input = queue.shift(); input; input = queue.shift()) {
            if (keyRefused) return;
            try {
                const answer = await askCitationSupport(args.apiKey, input.state, args.deps);
                const { error } = await args.db.from("citation_support_checks").insert({
                    organization_id: args.scope.orgId,
                    [OWNER_COLUMN[args.scope.surface]]: args.scope.ownerId,
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
 * The permission to check for one person's work, or null when it does not
 * exist: the server switch is off, there is no platform key, the person
 * opted out, or they have not accepted the current legal version. Nothing is
 * read or sent in those cases. Read once; `run` may then be called for as many
 * rows as the work produces (one answer, or every cell of a tabular run).
 */
export type CitationSupportRunner = {
    run: (
        owner: { surface: CitationSupportSurface; ownerId: string },
        inputs: readonly CitationSupportInput[],
    ) => Promise<CitationSupportOutcome | null>;
};

export async function createCitationSupportRunner(args: {
    db: Db;
    /** The person whose action triggered the generation: their opt-out and acceptance count. */
    userId: string;
    /** The organization of the space (a personal organization counts as none), or a lookup read only when something is checked. */
    orgId: string | null | undefined | (() => Promise<string | null | undefined>);
    /** The current LEGAL_VERSION: only people who accepted it are ever sent. */
    legalVersion: string;
    deps?: SupportDeps;
}): Promise<CitationSupportRunner | null> {
    const apiKey = citationCheckApiKey();
    if (!apiKey) return null;
    try {
        if (!(await citationCheckPermitted(args.db, args.userId, args.legalVersion))) return null;
    } catch {
        return null; // Silent mode: a failed preference read is "no check".
    }
    return {
        // Never throws and is never awaited by the work it follows.
        run: async (owner, inputs) => {
            if (!inputs.length) return null;
            try {
                const outcome = await runCitationSupportChecks({
                    db: args.db,
                    apiKey,
                    scope: {
                        orgId: await teamOrgIdOf(args.db, typeof args.orgId === "function" ? await args.orgId() : args.orgId),
                        ...owner,
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

/**
 * One answer's silent check. `collect` goes to the engine, which hands it the
 * inputs once the citations are verified; `finish` runs after the answer is
 * saved.
 */
export type CitationSupportTurn = {
    collect: (inputs: CitationSupportInput[]) => void;
    finish: (messageId: string | null | undefined, saved: boolean) => Promise<CitationSupportOutcome | null>;
};

/** The check for one chat answer, or null when it does not exist for it (see createCitationSupportRunner). */
export async function createCitationSupportTurn(args: {
    db: Db;
    userId: string;
    orgId: string | null | undefined;
    surface: "chat" | "word" | "tabular_chat";
    legalVersion: string;
    deps?: SupportDeps;
}): Promise<CitationSupportTurn | null> {
    const runner = await createCitationSupportRunner(args);
    if (!runner) return null;
    let inputs: CitationSupportInput[] = [];
    return {
        collect: (collected) => {
            inputs = collected;
        },
        // Detached from the turn: the caller does not await it.
        finish: async (messageId, saved) => {
            if (!saved || !messageId) return null;
            return runner.run({ surface: args.surface, ownerId: messageId }, inputs);
        },
    };
}

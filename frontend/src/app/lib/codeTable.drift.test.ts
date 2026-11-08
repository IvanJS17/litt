import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_KINDS } from "@mike/client";
import { SOURCE_MESSAGES, loadMessages } from "@litt/i18n";

/**
 * `CODE_KINDS` decides what a failure is called and whether Retry and
 * "Contact support" are offered, keyed by the `code` a server sent. Before
 * this guard the table listed codes no server had ever emitted
 * (`validation_error`, `service_unavailable`, `too_many_requests`,
 * `unauthorized`, …): it looked like coverage, while every real failure
 * fell through to the status-based classification underneath.
 *
 * Nothing throws when a code is wrong, so only a drift check catches it.
 * Every key must appear as a string literal in a tree that produces
 * responses: the API, or the Next proxy route that answers when the API
 * cannot be reached.
 */

const ROOT = path.resolve(__dirname, "../../../..");
const SOURCE_TREES = [
    path.join(ROOT, "backend", "src"),
    path.join(ROOT, "frontend", "src", "app", "api"),
];

function collectSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectSources(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(readFileSync(full, "utf8"));
        }
    }
    return out;
}

describe("CODE_KINDS", () => {
    const sources = SOURCE_TREES.flatMap((tree) => collectSources(tree));

    it("reads more than one file per tree", () => {
        expect(sources.length).toBeGreaterThan(100);
    });

    it("only lists codes a server actually emits", () => {
        const unknown = Object.keys(CODE_KINDS).filter((code) => {
            const literal = `"${code}"`;
            return !sources.some((source) => source.includes(literal));
        });
        expect(unknown).toEqual([]);
    });
});

/**
 * Codes with no catalog sentence (`errors.code`): the server's own words
 * carry a value a fixed sentence would drop (a limit, a model, a name, the
 * field that failed), or the code is a 5xx whose sentence comes from its
 * kind or from `errors.upstream`. They show the server's detail, in English
 * until that route sends a translatable code (plan i18n R5).
 */
const KEEPS_SERVER_WORDS = new Set([
    "upload_file_too_large", // the size limit
    "upload_batch_too_large", // the size limit
    "invalid_request", // which input was wrong
    "password_too_short", // the policy's number
    "password_too_long", // the policy's number
    "missing_api_key", // the model and provider
    "model_unavailable", // the model
    "model_required", // where to choose it
    "org_successor_required", // the organization
    "training_attempt_required", // too short or too long, and by how much
    "training_pass_invalid", // which part of the pass
    "training_pass_limit_reached", // the limit
    "training_correction_invalid", // which part of the batch
    "internal_error", // 5xx: the server kind's sentence
    "upstream_unavailable", // 5xx: errors.upstream
]);

describe("errors.code, the catalog's sentence per CODE_KINDS code", () => {
    it("covers every code once: a sentence, or a reason to keep the server's", async () => {
        const withText = Object.keys(SOURCE_MESSAGES.errors.code);
        expect(withText.filter((code) => !(code in CODE_KINDS))).toEqual([]);
        expect(withText.filter((code) => KEEPS_SERVER_WORDS.has(code))).toEqual([]);
        expect(
            Object.keys(CODE_KINDS).filter(
                (code) => !withText.includes(code) && !KEEPS_SERVER_WORDS.has(code),
            ),
        ).toEqual([]);
        expect([...KEEPS_SERVER_WORDS].filter((code) => !(code in CODE_KINDS))).toEqual([]);
        // es-MX has the same keys (the catalog parity test checks the rest).
        expect(Object.keys((await loadMessages("es-MX")).errors.code).sort()).toEqual(withText.sort());
    });
});

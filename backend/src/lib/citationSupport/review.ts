// Read side of the citation support check (docs/citation-support-check.md).
//
// The lawyer is shown ONE thing from the stored results: which citations
// Jev's answer put in the low band (`not_supported`, probability < 0.3), so
// the screen can say "Check this citation". Never a probability, never the
// other bands: nothing is said about a citation that was not flagged.
//
// This reads with the service role, so it performs NO authorization. A caller
// passes only owner ids it has already authorised the person to read through
// the owner's own access check (the chat, the Word chat, the review, the
// playbook), and attaches the result to that same payload.
import { citationCheckEnabled } from "../chatFeatureGates";
import { reportError } from "../observability/report";
import { AppError } from "../appError";
import { selectAllByKey, selectInBatches } from "../batchedQuery";
import type { Db } from "../supabase";
import type { CitationSupportSurface } from "./check";
import { QUESTION_VERSION } from "./typesafe";

const OWNER_COLUMN: Record<CitationSupportSurface, string> = {
    chat: "message_id",
    word: "word_message_id",
    tabular_cell: "tabular_cell_id",
    tabular_chat: "tabular_chat_message_id",
    playbook: "playbook_id",
};

/** The `[n]` references to check again, ascending; owners with none are absent. */
export type ReviewRefsByOwner = Map<string, number[]>;

/**
 * The low-band citation refs of the given owners, or an empty map when the
 * server switch is off or the read fails (the hint is an extra: the payload it
 * decorates must never fail because of it). Only the current question
 * version counts: bands from another question mean something else.
 */
export async function readReviewRefs(
    db: Db,
    surface: CitationSupportSurface,
    ownerIds: readonly string[],
): Promise<ReviewRefsByOwner> {
    const byOwner: ReviewRefsByOwner = new Map();
    if (!citationCheckEnabled() || ownerIds.length === 0) return byOwner;
    const column = OWNER_COLUMN[surface];
    try {
        const rows = await selectInBatches<Record<string, unknown>>(
            "Citation review refs load",
            ownerIds,
            (batch) =>
                selectAllByKey<Record<string, unknown>>("Citation review refs load", () =>
                    db
                        .from("citation_support_checks")
                        .select(`id, ${column}, citation_ref`)
                        .eq("band", "not_supported")
                        .eq("question_version", QUESTION_VERSION)
                        .in(column, batch),
                ),
        );
        for (const row of rows) {
            const owner = row[column];
            const ref = row.citation_ref;
            if (typeof owner !== "string" || typeof ref !== "number") continue;
            const refs = byOwner.get(owner) ?? [];
            if (!refs.includes(ref)) refs.push(ref);
            byOwner.set(owner, refs);
        }
        for (const refs of byOwner.values()) refs.sort((a, b) => a - b);
        return byOwner;
    } catch (error) {
        reportError(
            new AppError("citation_support.review_read_failed", "Citation review refs read failed", {
                cause: error,
            }),
            { level: "warning", tags: { component: "citation-support" } },
        );
        return new Map();
    }
}

/** `reviewRefs` for one owner, in the shape every payload carries. */
export function reviewRefsOf(byOwner: ReviewRefsByOwner, ownerId: unknown): number[] {
    return (typeof ownerId === "string" && byOwner.get(ownerId)) || [];
}

/**
 * The low-band refs of a draft playbook, only while the playbook is as the
 * draft left it. A playbook's refs are positions in its content when it was
 * drafted, so once anyone changes it (`updatedAt` later than the first stored
 * result, which is written after the draft is saved) they could point at the
 * wrong rule and nothing is returned.
 */
export async function readDraftReviewRefs(
    db: Db,
    playbookId: string,
    updatedAt: string,
): Promise<number[]> {
    if (!citationCheckEnabled()) return [];
    try {
        const { data, error } = await db
            .from("citation_support_checks")
            .select("citation_ref, band, created_at")
            .eq("playbook_id", playbookId)
            .eq("question_version", QUESTION_VERSION);
        if (error) throw error;
        const rows = (data ?? []) as { citation_ref: number; band: string; created_at: string }[];
        if (rows.length === 0) return [];
        const firstWritten = Math.min(...rows.map((row) => Date.parse(row.created_at)));
        if (!(Date.parse(updatedAt) <= firstWritten)) return [];
        return rows
            .filter((row) => row.band === "not_supported")
            .map((row) => row.citation_ref)
            .sort((a, b) => a - b);
    } catch (error) {
        reportError(
            new AppError("citation_support.review_read_failed", "Citation review refs read failed", {
                cause: error,
            }),
            { level: "warning", tags: { component: "citation-support" } },
        );
        return [];
    }
}

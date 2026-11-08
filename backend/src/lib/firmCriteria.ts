// The firm's criteria (docs/training.md, "One mold of criterion"): positions
// a person of the firm wrote under their name, and dissenting opinions that
// name a playbook rule. They are the firm's content, not learning data.
//
// This file holds what the HTTP module and the engine's list_firm_criteria
// tool share: the limits, the input check, the choice of which criteria
// answer a question, and the reads. LiTT gives a criterion no legal
// authority: it only says who wrote what, and when.

import type {
    FirmCriterionInput,
    FirmCriterionKind,
    FirmCriterionSnapshot,
} from "@mike/contracts";
import { loadCreatorProfiles, profileAttributionName } from "./userLookup";
import type { Db } from "./supabase";
import { isStorablePractice, normalizePractice, TRAINING_PRACTICE_MAX_CHARS } from "./training";

export const FIRM_CRITERION_KINDS: readonly FirmCriterionKind[] = ["criterio", "voto_particular"];
export const FIRM_CRITERION_TOPIC_MAX_CHARS = 120;
export const FIRM_CRITERION_POSITION_MAX_CHARS = 2000;
export const FIRM_CRITERION_RULE_ID_MAX_CHARS = 100;
/** How many criteria an organization holds; more is a 409. */
export const FIRM_CRITERIA_MAX_PER_ORG = 500;
/** How many criteria one consultation carries to the assistant and the screen. */
export const FIRM_CRITERIA_CONSULT_MAX = 8;
export const FIRM_CRITERIA_LIMIT_CODE = "firm_criteria_limit_reached";
export const FIRM_CRITERIA_RULE_NOT_FOUND_CODE = "firm_criteria_rule_not_found";

export type FirmCriterionRow = {
    id: string;
    org_id: string;
    author_user_id: string | null;
    kind: FirmCriterionKind;
    practice: string | null;
    topic: string;
    position: string;
    playbook_id: string | null;
    rule_id: string | null;
    created_at: string;
    updated_at: string;
};

export const FIRM_CRITERION_COLUMNS =
    "id, org_id, author_user_id, kind, practice, topic, position, playbook_id, rule_id, created_at, updated_at";

export type ParsedFirmCriterion = {
    kind: FirmCriterionKind;
    practice: string | null;
    topic: string;
    position: string;
    playbookId: string | null;
    ruleId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
    return typeof value === "string" ? value.trim() : null;
}

/** The request body as a criterion to store, or the one thing to fix. */
export function parseFirmCriterionInput(
    body: unknown,
): { ok: true; value: ParsedFirmCriterion } | { ok: false; detail: string } {
    const input = (body && typeof body === "object" ? body : {}) as Partial<
        Record<keyof FirmCriterionInput, unknown>
    >;
    const kind = input.kind ?? "criterio";
    if (!FIRM_CRITERION_KINDS.includes(kind as FirmCriterionKind)) {
        return { ok: false, detail: "The kind is not valid." };
    }
    const topic = text(input.topic);
    if (!topic || topic.length > FIRM_CRITERION_TOPIC_MAX_CHARS) {
        return { ok: false, detail: `The topic needs 1 to ${FIRM_CRITERION_TOPIC_MAX_CHARS} characters.` };
    }
    const position = text(input.position);
    if (!position || position.length > FIRM_CRITERION_POSITION_MAX_CHARS) {
        return { ok: false, detail: `The position needs 1 to ${FIRM_CRITERION_POSITION_MAX_CHARS} characters.` };
    }
    let practice: string | null = null;
    if (input.practice !== undefined && input.practice !== null && input.practice !== "") {
        if (typeof input.practice !== "string") return { ok: false, detail: "The practice area is not valid." };
        practice = normalizePractice(input.practice);
        if (
            practice === null ||
            practice.length > TRAINING_PRACTICE_MAX_CHARS ||
            !isStorablePractice(practice)
        ) {
            return { ok: false, detail: "The practice area is not valid." };
        }
    }
    let playbookId: string | null = null;
    let ruleId: string | null = null;
    if (kind === "voto_particular") {
        playbookId = text(input.playbook_id);
        ruleId = text(input.rule_id);
        if (!playbookId || !UUID.test(playbookId)) return { ok: false, detail: "A dissenting opinion needs the playbook." };
        if (!ruleId || ruleId.length > FIRM_CRITERION_RULE_ID_MAX_CHARS) {
            return { ok: false, detail: "A dissenting opinion needs the rule." };
        }
    } else if (input.playbook_id || input.rule_id) {
        return { ok: false, detail: "Only a dissenting opinion names a rule." };
    }
    return { ok: true, value: { kind: kind as FirmCriterionKind, practice, topic, position, playbookId, ruleId } };
}

/** Lower case, no accents, single spaces: how a topic is compared. */
export function foldForMatch(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

const MIN_WORD = 4;

function words(value: string): string[] {
    return [...new Set(foldForMatch(value).split(" ").filter((word) => word.length >= MIN_WORD))];
}

/**
 * Which criteria answer a question about a practice area and a topic, best
 * first. A criterion of another practice area is left out (one for any
 * practice area always fits); with a topic, a criterion has to share a word
 * of four letters or more with it; without one, the most recent come first.
 */
export function selectFirmCriteria(
    rows: readonly FirmCriterionRow[],
    query: { practice?: string | null; topic?: string | null },
    max: number = FIRM_CRITERIA_CONSULT_MAX,
): { rows: FirmCriterionRow[]; truncated: boolean } {
    const practice = normalizePractice(query.practice ?? null);
    const topicWords = words(query.topic ?? "");
    const scored: { row: FirmCriterionRow; score: number }[] = [];
    for (const row of rows) {
        if (practice && row.practice && row.practice !== practice) continue;
        let score = 0;
        if (topicWords.length > 0) {
            const heading = new Set(words(row.topic));
            const body = new Set(words(row.position));
            for (const word of topicWords) score += (heading.has(word) ? 3 : 0) + (body.has(word) ? 1 : 0);
            if (score === 0) continue;
        }
        if (practice && row.practice === practice) score += 2;
        scored.push({ row, score });
    }
    scored.sort(
        (a, b) =>
            b.score - a.score ||
            (a.row.updated_at < b.row.updated_at ? 1 : a.row.updated_at > b.row.updated_at ? -1 : 0) ||
            (a.row.id < b.row.id ? -1 : 1),
    );
    return { rows: scored.slice(0, max).map((item) => item.row), truncated: scored.length > max };
}

/** Every criterion of the organization, most recently changed first. */
export async function loadFirmCriteria(db: Db, orgId: string): Promise<FirmCriterionRow[]> {
    const { data, error } = await db
        .from("firm_criteria")
        .select(FIRM_CRITERION_COLUMNS)
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(FIRM_CRITERIA_MAX_PER_ORG);
    if (error) throw error;
    return (data ?? []) as unknown as FirmCriterionRow[];
}

/**
 * The rows as the screen and the assistant show them, with the author's name
 * as their profile gives it (the same attribution as a playbook correction).
 * A deleted user has no id and no name.
 */
export async function toFirmCriterionSnapshots(
    db: Db,
    rows: readonly FirmCriterionRow[],
): Promise<FirmCriterionSnapshot[]> {
    const profiles = await loadCreatorProfiles(
        db,
        rows.map((row) => ({ user_id: row.author_user_id })),
    );
    return rows.map((row) => {
        const profile = row.author_user_id ? profiles.get(row.author_user_id) : undefined;
        const name = profile ? profileAttributionName(profile, "") : "";
        return {
            id: row.id,
            kind: row.kind,
            practice: row.practice,
            topic: row.topic,
            position: row.position,
            author_user_id: row.author_user_id,
            author_name: name || null,
            playbook_id: row.playbook_id,
            rule_id: row.rule_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    });
}

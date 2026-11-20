import { checkProjectAccess } from "../../lib/access";
import { selectAllByKey, selectInBatches } from "../../lib/batchedQuery";
import { mapWithConcurrency } from "../../lib/concurrency";
import type { Db } from "../../lib/supabase";
import { readableMatterIds } from "./matterRequestsExport";

type Row = Record<string, unknown>;

const sortRows = (rows: Row[]) =>
    [...rows].sort((a, b) => `${a.created_at}${a.id}`.localeCompare(`${b.created_at}${b.id}`));

/**
 * The profile facts of retainer matters that the holder captured, and the
 * events (created, confirmed, rejected) that they recorded, in the matters they
 * can still open. A fact carries a quote of a firm document, so, like the
 * requests, it is matter work: it stays with the firm when the holder is no
 * longer on the matter. Only an organization's export carries them.
 */
export async function loadUserProfileFacts(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: string | null,
): Promise<{ facts: Row[]; events: Row[] }> {
    if (!orgId) return { facts: [], events: [] };
    const facts = await selectAllByKey<Row>("export matter_profile_facts", () =>
        (db as any)
            .from("matter_profile_facts")
            .select("id, matter_id, kind, label, data, document_id, version_id, start_char, end_char, quote, text_sha256, created_by, created_at")
            .eq("created_by", userId),
    );
    const events = await selectAllByKey<Row>("export matter_profile_fact_events", () =>
        (db as any)
            .from("matter_profile_fact_events")
            .select("id, fact_id, matter_id, action, text_sha256, reason, created_at")
            .eq("actor_user_id", userId),
    );
    const matterIds = [...new Set([...facts, ...events].map((row) => row.matter_id as string))];
    if (matterIds.length === 0) return { facts: [], events: [] };
    const readable = await readableMatterIds(db, userId, userEmail, orgId, matterIds);
    return {
        facts: sortRows(facts.filter((row) => readable.has(row.matter_id as string))),
        events: sortRows(events.filter((row) => readable.has(row.matter_id as string))),
    };
}

/**
 * The radar actions (acknowledged, dismissed, done) the holder recorded, in the
 * matters they can still open. Matter work, like the facts they react to: it
 * stays with the firm when the holder is no longer on the matter. Only an
 * organization's export carries them.
 */
export async function loadUserRadarEvents(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: string | null,
): Promise<Row[]> {
    if (!orgId) return [];
    const events = await selectAllByKey<Row>("export matter_radar_item_events", () =>
        (db as any)
            .from("matter_radar_item_events")
            .select("id, fact_id, matter_id, item_type, action, due_on, reason, created_at")
            .eq("actor_user_id", userId),
    );
    const matterIds = [...new Set(events.map((row) => row.matter_id as string))];
    if (matterIds.length === 0) return [];
    const readable = await readableMatterIds(db, userId, userEmail, orgId, matterIds);
    return sortRows(events.filter((row) => readable.has(row.matter_id as string)));
}

/**
 * What the holder decided about obligation rules, in the matters they can
 * still open: the rules they turned on or off and the actions (acknowledged,
 * dismissed, done) they recorded on the items of those rules. Matter work, like
 * the radar actions: it stays with the firm when the holder leaves the matter.
 * Only an organization's export carries them.
 */
export async function loadUserObligationEvents(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: string | null,
): Promise<{ rules: Row[]; items: Row[] }> {
    if (!orgId) return { rules: [], items: [] };
    const rules = await selectAllByKey<Row>("export matter_obligation_rule_events", () =>
        (db as any)
            .from("matter_obligation_rule_events")
            .select("id, matter_id, rule_code, rule_version, action, anchor_fact_id, anchor_mode, created_at")
            .eq("actor_user_id", userId),
    );
    const items = await selectAllByKey<Row>("export matter_obligation_item_events", () =>
        (db as any)
            .from("matter_obligation_item_events")
            .select("id, matter_id, item_key, action, due_on, reason, created_at")
            .eq("actor_user_id", userId),
    );
    const matterIds = [...new Set([...rules, ...items].map((row) => row.matter_id as string))];
    if (matterIds.length === 0) return { rules: [], items: [] };
    const readable = await readableMatterIds(db, userId, userEmail, orgId, matterIds);
    return {
        rules: sortRows(rules.filter((row) => readable.has(row.matter_id as string))),
        items: sortRows(items.filter((row) => readable.has(row.matter_id as string))),
    };
}

/**
 * The "retainer report sent" records the holder made, in the matters they can
 * still open. Matter work, like the requests it summarizes: it stays with the
 * firm when the holder is no longer on the matter. Only an organization's
 * export carries them.
 */
export async function loadUserReportSentEvents(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: string | null,
): Promise<Row[]> {
    if (!orgId) return [];
    const events = await selectAllByKey<Row>("export matter_report_sent_events", () =>
        (db as any)
            .from("matter_report_sent_events")
            .select("id, matter_id, period_start, period_end, period_days, note, created_at")
            .eq("actor_user_id", userId),
    );
    const matterIds = [...new Set(events.map((row) => row.matter_id as string))];
    if (matterIds.length === 0) return [];
    const readable = await readableMatterIds(db, userId, userEmail, orgId, matterIds);
    return sortRows(events.filter((row) => readable.has(row.matter_id as string)));
}

/**
 * The rule suggestions the holder asked for, and the decisions (accepted,
 * discarded, sent_to_legal, implemented) they recorded. A matter suggestion
 * carries a quote of a firm document, so, like the profile facts, it is matter
 * work: it stays with the firm when the holder is no longer on the matter. A
 * rule proposal (S8b: a draft from a law text, no matter) is project work and
 * follows the same rule: it is carried only while the holder can still open
 * its project. Only an organization's export carries them.
 */
export async function loadUserRuleSuggestions(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: string | null,
): Promise<{ suggestions: Row[]; events: Row[]; questions: Row[]; answers: Row[] }> {
    if (!orgId) return { suggestions: [], events: [], questions: [], answers: [] };
    const suggestions = await selectAllByKey<Row>("export obligation_rule_suggestions", () =>
        (db as any)
            .from("obligation_rule_suggestions")
            .select("id, flow, org_id, matter_id, project_id, document_id, version_id, text_sha256, start_char, end_char, quote, page, rule_code, rule_version, ai_reason, draft, ai_provider, ai_model, question_id, run_id, created_by, created_at")
            .eq("created_by", userId),
    );
    // S8c: the questions the holder was asked about and the answers the holder gave (never shown to any AI).
    const questions = await selectAllByKey<Row>("export obligation_rule_questions", () =>
        (db as any)
            .from("obligation_rule_questions")
            .select("id, org_id, matter_id, project_id, rule_code, rule_version, run_id, created_by, created_at")
            .eq("created_by", userId),
    );
    const answers = await selectAllByKey<Row>("export obligation_rule_question_answers", () =>
        (db as any)
            .from("obligation_rule_question_answers")
            .select("id, question_id, matter_id, answer, created_at")
            .eq("actor_user_id", userId),
    );
    const events = await selectAllByKey<Row>("export obligation_rule_suggestion_events", () =>
        (db as any)
            .from("obligation_rule_suggestion_events")
            .select("id, suggestion_id, matter_id, action, reason, catalog_code, created_at")
            .eq("actor_user_id", userId),
    );
    // A draft's event names no matter and no project: its project is its suggestion's.
    const projectOf = new Map(suggestions.map((row) => [row.id as string, row.project_id as string | null]));
    const missing = [...new Set(events.filter((row) => row.matter_id == null && !projectOf.has(row.suggestion_id as string)).map((row) => row.suggestion_id as string))];
    if (missing.length > 0) {
        const parents = await selectInBatches<Row>("export obligation_rule_suggestions parents", missing, (batch) =>
            (db as any).from("obligation_rule_suggestions").select("id, project_id").in("id", batch),
        );
        for (const parent of parents) projectOf.set(parent.id as string, parent.project_id as string | null);
    }
    const matterIds = [...new Set([...suggestions, ...events, ...questions, ...answers].map((row) => row.matter_id as string | null).filter((id): id is string => typeof id === "string"))];
    const readable = matterIds.length > 0 ? await readableMatterIds(db, userId, userEmail, orgId, matterIds) : new Set<string>();
    const projectIds = [...new Set([...projectOf.values()].filter((id): id is string => typeof id === "string"))];
    const openable = new Set<string>();
    await mapWithConcurrency(projectIds, 8, async (projectId) => {
        if ((await checkProjectAccess(projectId, userId, userEmail, db)).ok) openable.add(projectId);
    });
    const keep = (row: Row, project: string | null | undefined) =>
        typeof row.matter_id === "string" ? readable.has(row.matter_id) : typeof project === "string" && openable.has(project);
    return {
        suggestions: sortRows(suggestions.filter((row) => keep(row, row.project_id as string | null))),
        events: sortRows(events.filter((row) => keep(row, projectOf.get(row.suggestion_id as string)))),
        questions: sortRows(questions.filter((row) => keep(row, null))),
        answers: sortRows(answers.filter((row) => keep(row, null))),
    };
}

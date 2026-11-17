import { selectAllByKey } from "../../lib/batchedQuery";
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

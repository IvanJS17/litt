import { checkProjectAccess } from "../../lib/access";
import { mapWithConcurrency } from "../../lib/concurrency";
import { selectAllByKey, selectInBatches, sortRows, uniqueIds } from "../../lib/batchedQuery";
import type { Db } from "../../lib/supabase";

type Row = Record<string, unknown>;

/** What the export carries of a request (no title of another person's is ever read here). */
const REQUEST_COLUMNS =
    "id, matter_id, type_id, title, complexity, status, assignee_user_id, assignee_level, received_on, closed_on, version, created_by, created_at, updated_at";

const ids = (rows: Row[], column = "id") =>
    uniqueIds(rows.map((row) => (typeof row[column] === "string" ? (row[column] as string) : null)));

/**
 * The requests of retainer matters that name the holder (they created the
 * request or it is assigned to them) and the events they recorded, in the
 * matters they can still open. Matter work stays with the firm: a request of a
 * matter the holder was removed from, or one that names somebody else, is not
 * the holder's to take. Requests live in a firm's matters, so only an
 * organization's export carries them.
 */
export async function loadUserMatterRequests(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: string | null,
): Promise<{ requests: Row[]; events: Row[] }> {
    if (!orgId) return { requests: [], events: [] };
    const named = async (column: string) =>
        selectAllByKey<Row>("export matter_requests", () =>
            (db as any).from("matter_requests").select(REQUEST_COLUMNS).eq(column, userId),
        );
    const byId = new Map<string, Row>();
    for (const row of [...(await named("created_by")), ...(await named("assignee_user_id"))])
        byId.set(row.id as string, row);
    const candidates = [...byId.values()];
    const matterIds = ids(candidates, "matter_id");
    if (matterIds.length === 0) return { requests: [], events: [] };

    const matters = await selectInBatches<Row>("export matters", matterIds, (batch) =>
        (db as any).from("matters").select("id, project_id, workspace_id").in("id", batch),
    );
    const workspaces = await selectInBatches<Row>("export workspaces", ids(matters, "workspace_id"), (batch) =>
        (db as any).from("workspaces").select("id, organization_id").in("id", batch),
    );
    const inOrg = new Set(workspaces.filter((row) => row.organization_id === orgId).map((row) => row.id));
    const memberships = await selectInBatches<Row>("export matter_memberships", matterIds, (batch) =>
        (db as any)
            .from("matter_memberships")
            .select("matter_id, status")
            .in("matter_id", batch)
            .eq("user_id", userId)
            .eq("status", "active"),
    );
    const member = new Set(memberships.map((row) => row.matter_id));
    const openable = await mapWithConcurrency(matters, 8, async (matter) => {
        if (!inOrg.has(matter.workspace_id) || !member.has(matter.id) || typeof matter.project_id !== "string")
            return false;
        return (await checkProjectAccess(matter.project_id, userId, userEmail, db)).ok;
    });
    const readable = new Set(matters.filter((_, index) => openable[index]).map((row) => row.id));

    const requests = candidates.filter((row) => readable.has(row.matter_id));
    const events = (
        await selectAllByKey<Row>("export matter_request_events", () =>
            (db as any)
                .from("matter_request_events")
                .select("id, request_id, matter_id, action, detail, created_at")
                .eq("actor_user_id", userId),
        )
    ).filter((row) => readable.has(row.matter_id));
    return {
        requests: sortRows(requests, "created_at", "id"),
        events: sortRows(events, "created_at", "id"),
    };
}

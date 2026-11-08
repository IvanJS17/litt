// LiTT training layer 3 «Contraste de criterios» (docs/training.md): reading
// the contrasts of a junior.
//
// The rows are written by lib/trainingTurn/criteria.ts after the two steps of
// the contrast. This module shows them: to the person (their own, with the two
// analyses) and to their CURRENT mentor (the routes, the person's explanation
// and the comparison, for works in matters the mentor can open; the others are
// only counted). They are learning data, so every read goes through
// assertLearningAccess: nobody else gets one, not an owner or an admin, and any
// other case is the same 404.

import type {
    TrainingCriteriaContrast,
    TrainingCriteriaContrastRoute,
    TrainingCriteriaContrastStatus,
    TrainingMyCriteriaContrasts,
    TrainingPupilCriteriaContrast,
    TrainingPupilCriteriaContrasts,
} from "@mike/contracts";
import { internalFailure, failure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { mayOpenWorkMatter, workPlace } from "../../lib/trainingWork";
import { isUuid } from "../../lib/uuid";
import { assertCurrentMentor, assertLearningAccess, LEARNING_NOT_FOUND } from "../training-supervision/trainingSupervision.service";

type Row = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    chat_id: string;
    message_id: string;
    routes: unknown;
    briefs: unknown;
    status: TrainingCriteriaContrastStatus;
    person_explanation: string | null;
    comparison: string | null;
    created_at: string;
};

const COLUMNS = "id, org_id, trainee_user_id, chat_id, message_id, routes, briefs, status, person_explanation, comparison, created_at";
const MAX_LISTED = 100;

function routesOf(value: unknown): TrainingCriteriaContrastRoute[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const route = entry as Record<string, unknown>;
        const text = (key: string) => (typeof route[key] === "string" ? (route[key] as string) : undefined);
        const approach = route.approach === "literal" || route.approach === "systematic" ? route.approach : undefined;
        return [
            {
                ...(text("name") ? { name: text("name") } : {}),
                ...(approach ? { approach } : {}),
                ...(text("provider") ? { provider: text("provider") } : {}),
                ...(text("model") ? { model: text("model") } : {}),
                status: text("status") ?? "not_run",
            },
        ];
    });
}

function briefsOf(value: unknown): string[] | null {
    return Array.isArray(value) ? value.filter((brief): brief is string => typeof brief === "string") : null;
}

const presentMine = (row: Row): TrainingCriteriaContrast => ({
    id: row.id,
    org_id: row.org_id,
    chat_id: row.chat_id,
    status: row.status,
    routes: routesOf(row.routes),
    briefs: briefsOf(row.briefs),
    person_explanation: row.person_explanation,
    comparison: row.comparison,
    created_at: row.created_at,
});

/** The person's own contrasts, newest first, optionally one conversation's or one organization's. */
export async function getMyCriteriaContrasts(
    db: Db,
    args: { userId: string; chatId?: unknown; orgId?: unknown },
): Promise<ServiceResult<TrainingMyCriteriaContrasts>> {
    const id = (value: unknown): string | null | undefined =>
        value == null || value === "" ? null : typeof value === "string" && isUuid(value) ? value : undefined;
    const chatId = id(args.chatId);
    const orgId = id(args.orgId);
    if (chatId === undefined || orgId === undefined) return failure("not_found", LEARNING_NOT_FOUND);
    let query = db.from("training_criteria_contrasts").select(COLUMNS).eq("trainee_user_id", args.userId);
    if (chatId) query = query.eq("chat_id", chatId);
    if (orgId) query = query.eq("org_id", orgId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_LISTED);
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as Row[];
    for (const org of new Set(rows.map((row) => row.org_id))) {
        const access = await assertLearningAccess(db, { actorId: args.userId, orgId: org, traineeId: args.userId });
        if (!access.ok) return access;
    }
    return ok({ contrasts: rows.map(presentMine) });
}

/**
 * What a pupil's current mentor sees: the contrasts of the works in matters
 * the mentor can open, newest first (never ordered by performance). The ones
 * in other matters are only counted. The analyses stay in the pupil's chat.
 */
export async function getPupilCriteriaContrasts(
    db: Db,
    actor: { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown },
): Promise<ServiceResult<TrainingPupilCriteriaContrasts>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const { data, error } = await db
        .from("training_criteria_contrasts")
        .select(COLUMNS)
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(MAX_LISTED);
    if (error) return internalFailure(error);
    const visible: TrainingPupilCriteriaContrast[] = [];
    let hidden = 0;
    for (const row of (data ?? []) as unknown as Row[]) {
        const place = await workPlace(db, "chat", row.chat_id);
        if (!place.ok) return internalFailure(place.error);
        if (
            !place.place ||
            !(await mayOpenWorkMatter(db, { projectId: place.place.projectId, actorId: actor.actorId, actorEmail: actor.actorEmail }))
        ) {
            hidden += 1;
            continue;
        }
        visible.push({
            id: row.id,
            chat_id: row.chat_id,
            project_id: place.place.projectId,
            title: place.place.title,
            status: row.status,
            routes: routesOf(row.routes),
            person_explanation: row.person_explanation,
            comparison: row.comparison,
            created_at: row.created_at,
        });
    }
    return ok({ org_id: orgId, trainee_user_id: traineeId, contrasts: visible, contrasts_without_access: hidden });
}

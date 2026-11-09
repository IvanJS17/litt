// The mentor's gym cases (docs/training.md, layer 4).
//
// Who: a designated mentor of the organization, and each one sees and
// manages only their own cases (anyone else gets the same 404 as for a case
// that does not exist). A case is fictitious content; it is linked to no
// matter, document or client. The AI draft is never saved: it runs on the
// MENTOR's own route (governed BYOK, no fallback, llm.egress before any text
// is sent), is read strictly and, if it cannot be read, the call fails; there
// is no repair. The audit gets identifiers only.

import type { TrainingGymCase, TrainingGymCaseBody } from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { promptNonce } from "../../lib/promptFence";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    buildGymDraftPrompt,
    checkGymCase,
    GYM_DRAFT_MAX_ERRORS,
    GYM_DRAFT_MAX_TOKENS,
    GYM_DRAFT_SYSTEM_PROMPT,
    GYM_DRAFT_TOPIC_MAX_CHARS,
    parseGymDraft,
} from "../../lib/trainingGym";
import { completeSupervision } from "../../lib/trainingSupervisionAi";
import { isUuid } from "../../lib/uuid";
import { LEARNING_NOT_FOUND, mentorRoute } from "../training-supervision/trainingSupervision.service";
import { readPractice } from "../training/training.service";
import { parseCredentialRef, recordChatEgress } from "../user/user.service";

const CASE_LIST_LIMIT = 200;
const DRAFT_FAILED = "The draft could not be made just now. Try again.";

export type Mentor = { actorId: string; actorEmail: string | null; orgId: unknown };
type CaseRow = {
    id: string;
    org_id: string;
    created_by: string | null;
    practice: string;
    title: string;
    paragraphs: string[];
    errors: TrainingGymCaseBody["errors"];
    time_limit_minutes: number;
    created_at: string;
    updated_at: string;
};

const notFound = () => failure("not_found", LEARNING_NOT_FOUND);

export function serializeCase(row: CaseRow): TrainingGymCase {
    return {
        id: row.id,
        org_id: row.org_id,
        practice: row.practice,
        title: row.title,
        paragraphs: row.paragraphs,
        errors: row.errors,
        time_limit_minutes: row.time_limit_minutes,
        fictitious: true,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/** Only a designated mentor of the organization; anyone else gets a 404. */
async function assertMentor(db: Db, actor: Mentor): Promise<ServiceResult<string>> {
    if (typeof actor.orgId !== "string" || !isUuid(actor.orgId)) return notFound();
    const { data, error } = await db
        .from("training_mentors")
        .select("user_id")
        .eq("org_id", actor.orgId)
        .eq("user_id", actor.actorId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return data ? ok(actor.orgId) : notFound();
}

/** The case a mentor wrote, in this organization, or null. */
export async function loadOwnCase(
    db: Db,
    args: { orgId: string; actorId: string; caseId: unknown },
): Promise<ServiceResult<CaseRow | null>> {
    if (typeof args.caseId !== "string" || !isUuid(args.caseId)) return ok(null);
    const { data, error } = await db
        .from("training_gym_cases")
        .select("*")
        .eq("id", args.caseId)
        .eq("org_id", args.orgId)
        .eq("created_by", args.actorId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as unknown as CaseRow | null) ?? null);
}

/** The case as stored: practice normalized, shape checked. */
function readCase(body: unknown): ServiceResult<TrainingGymCaseBody> {
    const input = (body ?? {}) as { practice?: unknown };
    const practice = readPractice(input.practice);
    if (!practice.ok) return practice;
    if (practice.data === null) return failure("validation", "Choose a practice area.");
    const checked = checkGymCase(body);
    if (!checked.ok) return failure("validation", checked.detail);
    return ok({ practice: practice.data, ...checked.value });
}

const columns = (value: TrainingGymCaseBody) => ({
    practice: value.practice,
    title: value.title,
    paragraphs: value.paragraphs,
    errors: value.errors,
    time_limit_minutes: value.time_limit_minutes,
    fictitious: true,
});

/** GET …/gym/cases */
export async function listCases(db: Db, actor: Mentor): Promise<ServiceResult<TrainingGymCase[]>> {
    const gate = await assertMentor(db, actor);
    if (!gate.ok) return gate;
    const { data, error } = await db
        .from("training_gym_cases")
        .select("*")
        .eq("org_id", gate.data)
        .eq("created_by", actor.actorId)
        .order("created_at", { ascending: false })
        .limit(CASE_LIST_LIMIT);
    if (error) return internalFailure(error);
    return ok(((data ?? []) as unknown as CaseRow[]).map(serializeCase));
}

/** POST …/gym/cases */
export async function createCase(db: Db, actor: Mentor & { body: unknown }): Promise<ServiceResult<TrainingGymCase>> {
    const gate = await assertMentor(db, actor);
    if (!gate.ok) return gate;
    const value = readCase(actor.body);
    if (!value.ok) return value;
    const { data, error } = await db
        .from("training_gym_cases")
        .insert({
            org_id: gate.data,
            created_by: actor.actorId,
            ...columns(value.data),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
    if (error) return internalFailure(error);
    const row = data as unknown as CaseRow;
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId: gate.data,
        action: "training.gym_case_created",
        surface: "organization",
        detail: { org_id: gate.data, case_id: row.id },
    });
    return ok(serializeCase(row));
}

/** PUT …/gym/cases/:caseId: only the author. Attempts already given keep their copy. */
export async function updateCase(
    db: Db,
    actor: Mentor & { caseId: unknown; body: unknown },
): Promise<ServiceResult<TrainingGymCase>> {
    const gate = await assertMentor(db, actor);
    if (!gate.ok) return gate;
    const loaded = await loadOwnCase(db, { orgId: gate.data, actorId: actor.actorId, caseId: actor.caseId });
    if (!loaded.ok) return loaded;
    if (!loaded.data) return notFound();
    const value = readCase(actor.body);
    if (!value.ok) return value;
    const { data, error } = await db
        .from("training_gym_cases")
        .update({ ...columns(value.data), updated_at: new Date().toISOString() })
        .eq("id", loaded.data.id)
        .eq("created_by", actor.actorId)
        .select("*");
    if (error) return internalFailure(error);
    const row = ((data ?? []) as unknown as CaseRow[])[0];
    if (!row) return notFound();
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId: gate.data,
        action: "training.gym_case_updated",
        surface: "organization",
        detail: { org_id: gate.data, case_id: row.id },
    });
    return ok(serializeCase(row));
}

/** DELETE …/gym/cases/:caseId: only the author; attempts keep their copy (case_id becomes null). */
export async function deleteCase(db: Db, actor: Mentor & { caseId: unknown }): Promise<ServiceResult<null>> {
    const gate = await assertMentor(db, actor);
    if (!gate.ok) return gate;
    const loaded = await loadOwnCase(db, { orgId: gate.data, actorId: actor.actorId, caseId: actor.caseId });
    if (!loaded.ok) return loaded;
    if (!loaded.data) return notFound();
    const { error } = await db
        .from("training_gym_cases")
        .delete()
        .eq("id", loaded.data.id)
        .eq("created_by", actor.actorId);
    if (error) return internalFailure(error);
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId: gate.data,
        action: "training.gym_case_deleted",
        surface: "organization",
        detail: { org_id: gate.data, case_id: loaded.data.id },
    });
    return ok(null);
}

/** POST …/gym/cases/draft: `{ practice, topic, error_count, credential_ref? }`. Returns a case; saves nothing. */
export async function draftCase(db: Db, actor: Mentor & { body: unknown }): Promise<ServiceResult<TrainingGymCaseBody>> {
    const gate = await assertMentor(db, actor);
    if (!gate.ok) return gate;
    const body = (actor.body ?? {}) as { practice?: unknown; topic?: unknown; error_count?: unknown; credential_ref?: unknown };
    const practice = readPractice(body.practice);
    if (!practice.ok) return practice;
    if (practice.data === null) return failure("validation", "Choose a practice area.");
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    if (!topic || [...topic].length > GYM_DRAFT_TOPIC_MAX_CHARS)
        return failure("validation", `Write a topic of up to ${GYM_DRAFT_TOPIC_MAX_CHARS} characters.`);
    const count = body.error_count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > GYM_DRAFT_MAX_ERRORS)
        return failure("validation", `Ask for from 1 to ${GYM_DRAFT_MAX_ERRORS} errors.`);
    const credential = parseCredentialRef(body.credential_ref);
    if (!credential.ok) return failure("validation", credential.detail);

    // The mentor's own route; no fallback (409 when their key no longer serves).
    const route = await mentorRoute(db, {
        actorId: actor.actorId,
        orgId: gate.data,
        row: null,
        credentialRef: credential.value,
    });
    if (!route.ok) return route;
    const resolved = route.data;

    await recordChatEgress(db, {
        userId: actor.actorId,
        orgId: gate.data,
        chatId: null,
        surface: "training_gym",
        resolved,
        extra: { step: "draft" },
    });
    let draft: TrainingGymCaseBody | null = null;
    try {
        const text = await completeSupervision({
            model: resolved.route.model,
            apiKeys: resolved.apiKeys,
            systemPrompt: GYM_DRAFT_SYSTEM_PROMPT,
            user: buildGymDraftPrompt({ practice: practice.data, topic, count }, promptNonce()),
            maxTokens: GYM_DRAFT_MAX_TOKENS,
        });
        draft = parseGymDraft(text, { practice: practice.data, count });
        if (!draft) throw new Error("draft without the required format");
    } catch (error) {
        console.warn("[training] gym draft failed", { reason: error instanceof Error ? error.name : "error" });
    }
    return draft ? ok(draft) : failure("unavailable", DRAFT_FAILED);
}

// The firm's criteria (LiTT training layer 3, docs/training.md, "One mold of
// criterion"): the module's facade and, being small, its implementation.
//
//   read      every member of the organization, trainees included (a trainee's
//             turn consults them through the list_firm_criteria tool)
//   write     a member with no training stage, their own criteria only
//   remove    the author, or an owner or admin of the organization
//
// The criteria are the firm's content, not learning data: an owner or admin
// removing one is the same kind of act as removing any other firm content.
// A person who is not a member, or a criterion of another organization,
// gets the same 404. Each change writes one insert-only audit event with the
// ids and the kind; never the topic or the position.

import type { FirmCriteriaList, FirmCriterion } from "@mike/contracts";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import {
    FIRM_CRITERIA_LIMIT_CODE,
    FIRM_CRITERIA_MAX_PER_ORG,
    FIRM_CRITERIA_RULE_NOT_FOUND_CODE,
    FIRM_CRITERION_COLUMNS,
    loadFirmCriteria,
    parseFirmCriterionInput,
    toFirmCriterionSnapshots,
    type FirmCriterionRow,
    type ParsedFirmCriterion,
} from "../../lib/firmCriteria";
import { isPersonalOrg } from "../../lib/personalOrgs";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { getPlaybook, PlaybookRequestError } from "../playbooks/playbooks.service";

type Actor = { userId: string; userEmail?: string | null; orgId: unknown };

const NOT_FOUND = "Not found";

type Member = { orgId: string; admin: boolean; canWrite: boolean };

/** The caller as a member of a team organization, or the 404. */
async function member(db: Db, actor: Actor): Promise<ServiceResult<Member>> {
    if (typeof actor.orgId !== "string" || !isUuid(actor.orgId)) return failure("not_found", NOT_FOUND);
    try {
        if (await isPersonalOrg(db, actor.orgId)) return failure("not_found", NOT_FOUND);
        const role = await getOrgRole(actor.userId, actor.orgId, db);
        if (!role) return failure("not_found", NOT_FOUND);
        const { data, error } = await db
            .from("training_stages")
            .select("practice")
            .eq("org_id", actor.orgId)
            .eq("trainee_user_id", actor.userId)
            .limit(1);
        if (error) throw error;
        return ok({ orgId: actor.orgId, admin: isOrgAdmin(role), canWrite: (data ?? []).length === 0 });
    } catch (error) {
        return internalFailure(error);
    }
}

async function loadOne(db: Db, orgId: string, id: unknown): Promise<ServiceResult<FirmCriterionRow>> {
    if (typeof id !== "string" || !isUuid(id)) return failure("not_found", NOT_FOUND);
    const { data, error } = await db
        .from("firm_criteria")
        .select(FIRM_CRITERION_COLUMNS)
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return data ? ok(data as unknown as FirmCriterionRow) : failure("not_found", NOT_FOUND);
}

async function view(db: Db, row: FirmCriterionRow, userId: string): Promise<FirmCriterion> {
    const [snapshot] = await toFirmCriterionSnapshots(db, [row]);
    return { ...snapshot, mine: row.author_user_id === userId };
}

function audit(db: Db, actor: Actor, orgId: string, action: string, row: { id: string; kind: string }) {
    return recordAudit(db, {
        userId: actor.userId,
        userEmail: actor.userEmail ?? null,
        orgId,
        action,
        surface: "organization",
        detail: { org_id: orgId, criterion_id: row.id, kind: row.kind },
    });
}

/** A dissenting opinion names a rule of a playbook of this organization that the author can open. */
async function checkRule(db: Db, actor: Actor, orgId: string, parsed: ParsedFirmCriterion): Promise<ServiceResult<null>> {
    if (parsed.kind !== "voto_particular") return ok(null);
    const missing = failure("validation", "The rule is not in a playbook you can open.", FIRM_CRITERIA_RULE_NOT_FOUND_CODE);
    try {
        const playbook = await getPlaybook(actor.userId, parsed.playbookId!, db, actor.userEmail);
        if (playbook.orgId !== orgId) return missing;
        const found = playbook.content.topics.some((topic) => topic.rules.some((rule) => rule.id === parsed.ruleId));
        return found ? ok(null) : missing;
    } catch (error) {
        if (error instanceof PlaybookRequestError && error.status === 404) return missing;
        return internalFailure(error);
    }
}

function columns(parsed: ParsedFirmCriterion) {
    return {
        kind: parsed.kind,
        practice: parsed.practice,
        topic: parsed.topic,
        position: parsed.position,
        playbook_id: parsed.playbookId,
        rule_id: parsed.ruleId,
    };
}

export async function listFirmCriteria(db: Db, actor: Actor): Promise<ServiceResult<FirmCriteriaList>> {
    const who = await member(db, actor);
    if (!who.ok) return who;
    try {
        const rows = await loadFirmCriteria(db, who.data.orgId);
        const snapshots = await toFirmCriterionSnapshots(db, rows);
        return ok({
            criteria: snapshots.map((snapshot) => ({ ...snapshot, mine: snapshot.author_user_id === actor.userId })),
            can_write: who.data.canWrite,
            can_manage: who.data.admin,
            max_per_organization: FIRM_CRITERIA_MAX_PER_ORG,
        });
    } catch (error) {
        return internalFailure(error);
    }
}

export async function createFirmCriterion(db: Db, actor: Actor & { body: unknown }): Promise<ServiceResult<FirmCriterion>> {
    const who = await member(db, actor);
    if (!who.ok) return who;
    if (!who.data.canWrite) return failure("forbidden", "Only people with no training stage write criteria.");
    const parsed = parseFirmCriterionInput(actor.body);
    if (!parsed.ok) return failure("validation", parsed.detail);
    const rule = await checkRule(db, actor, who.data.orgId, parsed.value);
    if (!rule.ok) return rule;
    const { data: held, error: countError } = await db
        .from("firm_criteria")
        .select("id")
        .eq("org_id", who.data.orgId)
        .limit(FIRM_CRITERIA_MAX_PER_ORG);
    if (countError) return internalFailure(countError);
    if ((held ?? []).length >= FIRM_CRITERIA_MAX_PER_ORG) {
        return failure("conflict", "The organization holds as many criteria as it can.", FIRM_CRITERIA_LIMIT_CODE);
    }
    const { data, error } = await db
        .from("firm_criteria")
        .insert({ org_id: who.data.orgId, author_user_id: actor.userId, ...columns(parsed.value) })
        .select(FIRM_CRITERION_COLUMNS)
        .single();
    if (error || !data) return internalFailure(error);
    const row = data as unknown as FirmCriterionRow;
    await audit(db, actor, who.data.orgId, "firm_criteria.created", row);
    return ok(await view(db, row, actor.userId));
}

export async function updateFirmCriterion(
    db: Db,
    actor: Actor & { criterionId: unknown; body: unknown },
): Promise<ServiceResult<FirmCriterion>> {
    const who = await member(db, actor);
    if (!who.ok) return who;
    const current = await loadOne(db, who.data.orgId, actor.criterionId);
    if (!current.ok) return current;
    if (current.data.author_user_id !== actor.userId || !who.data.canWrite) {
        return failure("forbidden", "Only the author edits a criterion.");
    }
    const parsed = parseFirmCriterionInput(actor.body);
    if (!parsed.ok) return failure("validation", parsed.detail);
    const rule = await checkRule(db, actor, who.data.orgId, parsed.value);
    if (!rule.ok) return rule;
    const { data, error } = await db
        .from("firm_criteria")
        .update({ ...columns(parsed.value), updated_at: new Date().toISOString() })
        .eq("id", current.data.id)
        .eq("org_id", who.data.orgId)
        .eq("author_user_id", actor.userId)
        .select(FIRM_CRITERION_COLUMNS)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", NOT_FOUND);
    const row = data as unknown as FirmCriterionRow;
    await audit(db, actor, who.data.orgId, "firm_criteria.updated", row);
    return ok(await view(db, row, actor.userId));
}

export async function deleteFirmCriterion(
    db: Db,
    actor: Actor & { criterionId: unknown },
): Promise<ServiceResult<{ deleted: true }>> {
    const who = await member(db, actor);
    if (!who.ok) return who;
    const current = await loadOne(db, who.data.orgId, actor.criterionId);
    if (!current.ok) return current;
    if (current.data.author_user_id !== actor.userId && !who.data.admin) {
        return failure("forbidden", "Only the author or an administrator removes a criterion.");
    }
    const { error } = await db
        .from("firm_criteria")
        .delete()
        .eq("id", current.data.id)
        .eq("org_id", who.data.orgId);
    if (error) return internalFailure(error);
    await audit(db, actor, who.data.orgId, "firm_criteria.deleted", current.data);
    return ok({ deleted: true });
}

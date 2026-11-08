// The person's side of the periodic full reading (docs/training.md, layer 3).
//
// Who: only the person themself, on their own rows (the mentor reads through
// trainingFullReading.mentor.ts). Every call asks the learning-data rule
// first (assertLearningAccess); a row that is not the caller's is the same
// 404 as none.
//
// Flow: start (a junior, once the interval passed, none open) → LiTT proposes
// a document → [change it, once] → the person reads it WITHOUT the assistant
// (a page with only the document's text; it cannot be enforced technically,
// so the reading is the person's own statement) → they send what they found
// (written once, before the machine's list) → compare (trainingFullReading
// .compare.ts). It is evidence for the mentor and never a promotion
// requirement. The audit gets identifiers only.

import type {
    TrainingReading,
    TrainingReadingDocument,
    TrainingReadingEligibility,
    TrainingReadings,
} from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { checkFindings, isReadableDocumentText, isReadingDue, readingDueAt } from "../../lib/trainingReading";
import { readStoredDocumentText } from "../documents/documents.service";
import { assertLearningAccess } from "../training-supervision/trainingSupervision.service";
import { READING_NO_DOCUMENT_CODE, pickReadingDocument } from "./trainingFullReading.pick";
import { readingGeneration } from "./trainingFullReading.route";
import {
    isJuniorIn,
    loadOwnReading,
    readingNotFound,
    readReadings,
    serializeReading,
    type ReadingRow,
} from "./trainingFullReading.rows";

export const READING_NOT_DUE_CODE = "training_reading_not_due";
export const READING_SWAP_USED_CODE = "training_reading_swap_used";
export const READING_FINDINGS_RECORDED_CODE = "training_reading_findings_recorded";
export const READING_DOCUMENT_UNAVAILABLE_CODE = "training_reading_document_unavailable";
export { READING_NO_DOCUMENT_CODE };

const NOT_DUE = "There is no reading due for you right now.";
const SWAP_USED = "You already changed the proposed document once.";
const FINDINGS_RECORDED = "You already sent what you found; it cannot change.";
const UNAVAILABLE = "The document is no longer available to read.";

type Person = { userId: string; userEmail: string | null };

const self = (db: Db, userId: string, orgId: unknown) =>
    assertLearningAccess(db, { actorId: userId, orgId, traineeId: userId });

function eligibilityOf(rows: readonly ReadingRow[], junior: boolean, now: number): TrainingReadingEligibility {
    const last = rows.reduce<string | null>(
        (latest, row) => (row.submitted_at && (latest === null || row.submitted_at > latest) ? row.submitted_at : latest),
        null,
    );
    const open = rows.find((row) => row.status !== "compared") ?? null;
    return {
        is_junior: junior,
        due: junior && !open && isReadingDue(last, now),
        open_reading_id: open?.id ?? null,
        last_submitted_at: last,
        next_due_at: readingDueAt(last),
    };
}

/** GET /training/me/readings?org_id= */
export async function getMyReadings(
    db: Db,
    args: { userId: string; orgId: unknown },
): Promise<ServiceResult<TrainingReadings>> {
    const access = await self(db, args.userId, args.orgId);
    if (!access.ok) return access;
    const orgId = args.orgId as string;
    const rows = await readReadings(db, orgId, args.userId);
    if (!rows.ok) return rows;
    const junior = await isJuniorIn(db, orgId, args.userId);
    if (!junior.ok) return junior;
    const now = Date.now();
    return ok({
        org_id: orgId,
        eligibility: eligibilityOf(rows.data, junior.data, now),
        generation: await readingGeneration(db, args.userId, orgId),
        readings: rows.data.map((row) => serializeReading(row, now)),
    });
}

/** POST /training/me/readings: `{ org_id }`. Starts the reading that is due, or returns the one already open. */
export async function startReading(
    db: Db,
    args: Person & { orgId: unknown; now?: number; random?: () => number },
): Promise<ServiceResult<{ reading: TrainingReading; created: boolean }>> {
    const access = await self(db, args.userId, args.orgId);
    if (!access.ok) return access;
    const orgId = args.orgId as string;
    const now = args.now ?? Date.now();
    const rows = await readReadings(db, orgId, args.userId);
    if (!rows.ok) return rows;
    const open = rows.data.find((row) => row.status !== "compared");
    if (open) return ok({ reading: serializeReading(open, now), created: false });
    const junior = await isJuniorIn(db, orgId, args.userId);
    if (!junior.ok) return junior;
    if (!eligibilityOf(rows.data, junior.data, now).due) return failure("conflict", NOT_DUE, READING_NOT_DUE_CODE);

    const picked = await pickReadingDocument(db, { orgId, userId: args.userId, userEmail: args.userEmail, now, random: args.random });
    if (!picked.ok) return picked;
    const { data, error } = await db
        .from("training_readings")
        .insert({
            org_id: orgId,
            trainee_user_id: args.userId,
            project_id: picked.data.projectId,
            document_id: picked.data.documentId,
            version_id: picked.data.versionId,
            swapped: false,
            status: "assigned",
        })
        .select("*")
        .single();
    if (error) {
        // Two requests at once: the other one's reading is the open one.
        if ((error as { code?: string }).code === "23505") {
            const again = await readReadings(db, orgId, args.userId);
            const existing = again.ok ? again.data.find((row) => row.status !== "compared") : null;
            if (existing) return ok({ reading: serializeReading(existing, now), created: false });
        }
        return internalFailure(error);
    }
    const row = data as unknown as ReadingRow;
    await recordAudit(db, {
        userId: args.userId,
        userEmail: args.userEmail,
        orgId,
        action: "training.reading_assigned",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: args.userId, reading_id: row.id },
    });
    return ok({ reading: serializeReading(row, now), created: true });
}

/** The caller's reading `readingId` after the learning-data rule, or the 404. */
export async function ownReading(db: Db, args: { userId: string; readingId: unknown }): Promise<ServiceResult<ReadingRow>> {
    const loaded = await loadOwnReading(db, args);
    if (!loaded.ok) return loaded;
    if (!loaded.data) return readingNotFound();
    const access = await self(db, args.userId, loaded.data.org_id);
    if (!access.ok) return access;
    return ok(loaded.data);
}

/** POST /training/me/readings/:id/swap: another document, once, before sending the findings. */
export async function swapReading(
    db: Db,
    args: Person & { readingId: unknown; random?: () => number },
): Promise<ServiceResult<TrainingReading>> {
    const found = await ownReading(db, args);
    if (!found.ok) return found;
    const row = found.data;
    if (row.status !== "assigned") return failure("conflict", FINDINGS_RECORDED, READING_FINDINGS_RECORDED_CODE);
    if (row.swapped) return failure("conflict", SWAP_USED, READING_SWAP_USED_CODE);
    const picked = await pickReadingDocument(db, {
        orgId: row.org_id,
        userId: args.userId,
        userEmail: args.userEmail,
        exclude: row.document_id,
        random: args.random,
    });
    if (!picked.ok) return picked;
    const { data, error } = await db
        .from("training_readings")
        .update({
            project_id: picked.data.projectId,
            document_id: picked.data.documentId,
            version_id: picked.data.versionId,
            swapped: true,
            updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "assigned")
        .eq("swapped", false)
        .select("*");
    if (error) return internalFailure(error);
    const updated = ((data ?? []) as unknown as ReadingRow[])[0];
    if (!updated) return failure("conflict", SWAP_USED, READING_SWAP_USED_CODE);
    return ok(serializeReading(updated));
}

/** PUT /training/me/readings/:id/findings: `{ findings }`, written once. */
export async function submitFindings(
    db: Db,
    args: Person & { readingId: unknown; body: unknown },
): Promise<ServiceResult<TrainingReading>> {
    const found = await ownReading(db, args);
    if (!found.ok) return found;
    const row = found.data;
    if (row.status !== "assigned") return failure("conflict", FINDINGS_RECORDED, READING_FINDINGS_RECORDED_CODE);
    const checked = checkFindings((args.body as { findings?: unknown } | null)?.findings);
    if (!checked.ok) return failure("validation", checked.detail);
    const now = new Date().toISOString();
    const { data, error } = await db
        .from("training_readings")
        .update({ findings: checked.findings, submitted_at: now, status: "submitted", updated_at: now })
        .eq("id", row.id)
        .eq("status", "assigned")
        .select("*");
    if (error) {
        if ((error as { code?: string }).code === "LT002")
            return failure("conflict", FINDINGS_RECORDED, READING_FINDINGS_RECORDED_CODE);
        return internalFailure(error);
    }
    const updated = ((data ?? []) as unknown as ReadingRow[])[0];
    if (!updated) return failure("conflict", FINDINGS_RECORDED, READING_FINDINGS_RECORDED_CODE);
    await recordAudit(db, {
        userId: args.userId,
        userEmail: args.userEmail,
        orgId: row.org_id,
        action: "training.reading_submitted",
        surface: "organization",
        detail: { org_id: row.org_id, target_user_id: args.userId, reading_id: row.id },
    });
    return ok(serializeReading(updated));
}

/**
 * GET /training/me/readings/:id/document: the text to read, under the
 * person's own access to the document. The title is shown, never stored.
 */
export async function getReadingDocument(
    db: Db,
    args: Person & { readingId: unknown },
): Promise<ServiceResult<TrainingReadingDocument>> {
    const found = await ownReading(db, args);
    if (!found.ok) return found;
    const row = found.data;
    const unavailable = () => failure("conflict", UNAVAILABLE, READING_DOCUMENT_UNAVAILABLE_CODE);
    if (!row.document_id || !row.version_id) return unavailable();
    try {
        const stored = await readStoredDocumentText(db, {
            userId: args.userId,
            userEmail: args.userEmail,
            documentId: row.document_id,
            versionId: row.version_id,
        });
        if (stored?.status !== "ready" || !isReadableDocumentText(stored.text)) return unavailable();
        const version = await db.from("document_versions").select("filename").eq("id", row.version_id).maybeSingle();
        if (version.error) return internalFailure(version.error);
        return ok({
            reading_id: row.id,
            filename: (version.data as { filename?: string | null } | null)?.filename ?? null,
            text: stored.text,
        });
    } catch (error) {
        return internalFailure(error);
    }
}

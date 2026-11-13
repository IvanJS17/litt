// Re-authorize and build a durable export artifact. Retried requests overwrite the same path.
import { recordAudit } from "../../lib/audit";
import { assertAuthorizationStamp } from "../../lib/authorizationEpoch";
import {
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
    userExportFilename,
} from "./buildJsonExport";
import { AUDIT_CSV_FILENAME, buildAuditCsv, type AuditQuery } from "../../lib/auditExport";
import { createDocumentAccessChecker } from "../../lib/access";
import { selectInBatches } from "../../lib/batchedQuery";
import { mapWithConcurrency } from "../../lib/concurrency";
import { attachActiveVersionPaths, downloadFilenameForVersion } from "../../lib/documentVersions";
import { downloadFile, uploadFile } from "../../lib/storage";
import { assertVersionReleasable, type SealStage } from "../../lib/trainingRelease";
import type { Db } from "../../lib/supabase";
import type { ExportBuildRequest } from "./exportContracts";
import { buildMemoryArchive } from "../../lib/memory/archive";
import { NonRetryableJobError } from "../../lib/dbq/runner";
import { uniqueArchiveFilename } from "../../lib/zipExport";
import { memberDataActionAllowed } from "../../modules/orgs/orgs.service";
import {
    JsonExportType,
    MAX_ZIP_EXPORT_DOCUMENTS,
    ExportType,
    EXPORT_TYPES,
    isWorkspaceExportType,
} from "./exportContracts";
/** One finished artifact, ready to park in storage. */
type ExportArtifact = {
    body: Buffer;
    filename: string;
    /** Stored on the object and replayed as the download's Content-Type. */
    contentType: string;
};
const JSON_EXPORT_AUDIT_ACTIONS: Record<JsonExportType, string> = {
    account: "export.account",
    chats: "export.chats",
    "tabular-reviews": "export.tabular",
};
async function buildJsonExport(
    db: Db,
    userId: string,
    userEmail: string | null,
    type: JsonExportType,
    orgId: string | null,
): Promise<ExportArtifact> {
    const data =
        type === "account"
            ? await buildUserAccountExport(db, userId, userEmail, orgId)
            : type === "chats"
              ? await buildUserChatsExport(db, userId, userEmail, orgId)
              : await buildUserTabularReviewsExport(db, userId, userEmail, orgId);
    return {
        body: Buffer.from(JSON.stringify(data, null, 2), "utf8"),
        filename: userExportFilename(type, userId, orgId),
        contentType: "application/json",
    };
}
async function buildAuditCsvExport(db: Db, job: ExportBuildRequest, userId: string, userEmail: string | null): Promise<ExportArtifact> {
    // The route validated these params through parseQuery before enqueuing,
    // so a job without them is malformed rather than retryable.
    const query = job.payload.query as AuditQuery | undefined;
    if (!query || typeof query !== "object") {
        throw new Error(`[export.build] malformed payload on job ${job.id}`);
    }
    const csv = await buildAuditCsv(db, userId, userEmail ?? undefined, query);
    return {
        body: Buffer.from(csv, "utf8"),
        filename: query.orgId ? "organization-audit.csv" : AUDIT_CSV_FILENAME,
        contentType: "text/csv; charset=utf-8",
    };
}

/** The list of documents a "documents-zip" export left out, inside the zip. */
const OMITTED_LIST_FILENAME = "OMITIDOS.txt";

function omittedList(filenames: string[]): string {
    return [
        "Estos documentos no se incluyeron en la exportación:",
        "",
        ...filenames.map(
            (name) =>
                `- ${name}: borrador de pasante pendiente de aprobación.`,
        ),
        "",
        "Una persona que puede aprobar la versión debe aprobarla en LiTT antes de exportarla.",
        "",
    ].join("\n");
}

async function buildDocumentsZipExport(db: Db, job: ExportBuildRequest, userId: string, userEmail: string | null): Promise<ExportArtifact> {
    const documentIds = job.payload.document_ids as unknown;
    if (!Array.isArray(documentIds) ||
        documentIds.length === 0 ||
        documentIds.length > MAX_ZIP_EXPORT_DOCUMENTS ||
        documentIds.some((id) => typeof id !== "string" || !id)) {
        throw new Error(`[export.build] malformed payload on job ${job.id}`);
    }
    // org_id and workflow_id are part of the verdict, not decoration:
    // ensureDocAccess resolves a workflow asset through its workflow and an
    // org document through its org. Selecting only project_id/user_id made
    // both branches unreachable, so an org colleague's document and every
    // detached document were silently dropped from the zip. The sync route
    // already selects the full set.
    type ExportDocument = {
        id: string;
        user_id: string;
        project_id: string | null;
        org_id?: string | null;
        workflow_id?: string | null;
        current_version_id?: string | null;
        storage_path?: string | null;
        filename?: string | null;
        active_version_number?: number | null;
        source?: string | null;
        content_sha256?: string | null;
        training_stage?: SealStage;
    };
    const rawDocs = await selectInBatches<ExportDocument>(
        "export documents",
        documentIds as string[],
        (batch) =>
            db
                .from("documents")
                .select(
                    "id, current_version_id, user_id, project_id, org_id, workflow_id",
                )
                .in("id", batch),
    );

    // Access is re-checked HERE, not at enqueue time: the payload's ids are
    // stale by definition (a share can be revoked while the job waits), so a
    // doc the user can no longer read is skipped. One checker shares each
    // project/workflow verdict across its documents, and the active
    // versions are resolved in batches — 500 documents used to cost two
    // sequential round trips each before the first download.
    const check = createDocumentAccessChecker(userId, userEmail, db);
    const readable = (
        await mapWithConcurrency(rawDocs, 5, async (doc) => ((await check(doc)).ok ? doc : null))
    ).filter((doc): doc is ExportDocument => doc !== null);
    await attachActiveVersionPaths(db, readable);

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    let added = 0;
    const usedNames = new Set<string>();
    const omitted: string[] = [];
    for (const doc of readable) {
        if (!doc.storage_path || !doc.current_version_id) continue;
        const active = {
            storage_path: doc.storage_path,
            filename: doc.filename ?? "Untitled document",
            version_number: doc.active_version_number ?? null,
            source: doc.source ?? null,
        };
        const filename = downloadFilenameForVersion(
            active.filename,
            active.version_number,
            active.source === "assistant_edit",
        );
        // A pasante's unapproved draft stays in LiTT (docs/training.md): it
        // is left out and named in OMITIDOS.txt. A failed check retries.
        const releasable = await assertVersionReleasable(db, {
            id: doc.current_version_id,
            training_stage: doc.training_stage ?? null,
            content_sha256: doc.content_sha256 ?? null,
        });
        if (!releasable.ok) {
            if (releasable.kind !== "conflict")
                throw new Error(`[export.build] release check failed on job ${job.id}`);
            omitted.push(filename);
            continue;
        }
        const raw = await downloadFile(active.storage_path);
        if (!raw)
            continue;
        // Sequential, unlike the sync route's Promise.all: this path exists
        // for selections large enough that fetching every file at once is
        // what would blow the memory ceiling.
        zip.file(uniqueArchiveFilename(filename, usedNames), Buffer.from(raw));
        added++;
    }
    if (omitted.length > 0) zip.file(uniqueArchiveFilename(OMITTED_LIST_FILENAME, usedNames), omittedList(omitted));
    if (added === 0 && omitted.length === 0) {
        throw new Error(`[export.build] no accessible documents for job ${job.id}`);
    }
    return {
        body: await zip.generateAsync({
            type: "nodebuffer",
            compression: "DEFLATE",
        }),
        filename: "documents.zip",
        contentType: "application/zip",
    };
}
async function buildMemoryZipExport(
    db: Db,
    userId: string,
    userEmail: string | null,
    orgId: string | null,
): Promise<ExportArtifact> {
    return {
        body: await buildMemoryArchive(db, userId, userEmail, orgId),
        filename: orgId
            ? `litt-memory-export-${orgId.slice(0, 8)}.zip`
            : "litt-memory-export.zip",
        contentType: "application/zip",
    };
}
export async function buildExport(db: Db, job: ExportBuildRequest): Promise<Record<string, unknown>> {
    // LiTT C4: an organization audit export runs only under the epoch it was
    // queued with. Personal exports carry no stamp — they are the caller's own
    // data, and every resource they read is re-authorized while building.
    const exportOrgId =
        (job.payload.query as AuditQuery | undefined)?.orgId ?? null;
    await assertAuthorizationStamp(
        db,
        exportOrgId,
        job.payload.authorization,
    );
    const userId = job.payload.userId as string | undefined;
    const type = job.payload.type as ExportType | undefined;
    if (!userId || !type || !EXPORT_TYPES.includes(type)) {
        throw new Error(`[export.build] malformed payload on job ${job.id}`);
    }
    const userEmail = (job.payload.userEmail as string | undefined) ?? null;
    // The workspace a Settings export covers. A job queued before exports
    // had one carries none and is built as Personal, never as every
    // workspace.
    const orgId = typeof job.payload.orgId === "string" ? job.payload.orgId : null;
    // Checked again now: membership, or the organization's policy, may have
    // changed while the job waited.
    if (orgId &&
        isWorkspaceExportType(type) &&
        !(await memberDataActionAllowed(db, userId, orgId, "export"))) {
        throw new NonRetryableJobError(`[export.build] exports are not allowed for this member in ${orgId}`);
    }
    const artifact = type === "audit-csv"
        ? await buildAuditCsvExport(db, job, userId, userEmail)
        : type === "documents-zip"
            ? await buildDocumentsZipExport(db, job, userId, userEmail)
            : type === "memory-zip"
                ? await buildMemoryZipExport(db, userId, userEmail, orgId)
                : await buildJsonExport(db, userId, userEmail, type, orgId);
    // Path is namespaced under the user (account erasure purges the prefix)
    // and keyed by job id (a re-run overwrites its own artifact — idempotent).
    const storagePath = `exports/${userId}/${job.id}-${artifact.filename}`;
    const body = artifact.body;
    await uploadFile(storagePath, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, artifact.contentType);
    // The completion audit row replaces the one the old sync route wrote.
    // The filtered exports have no such row: neither of their sync routes
    // recorded one, and inventing it here would change the history feed.
    if (type === "memory-zip") {
        await recordAudit(db, {
            userId,
            userEmail,
            action: "export.memory",
            surface: "account",
        });
    }
    else if (type !== "audit-csv" && type !== "documents-zip") {
        await recordAudit(db, {
            userId,
            userEmail,
            action: JSON_EXPORT_AUDIT_ACTIONS[type],
            surface: "account",
        });
    }
    // No signed /download token here: that route only serves paths backed by
    // a live document_versions row, which an export artifact is not. The
    // client downloads through GET /user/exports/:id/download instead, which
    // re-checks ownership on every request and replays content_type.
    return {
        storage_path: storagePath,
        filename: artifact.filename,
        content_type: artifact.contentType,
    };
}

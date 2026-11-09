import { loadMemoryExport } from "../../lib/memory/export";
import {
    checkProjectAccess,
    checkWorkflowAccess,
    createDocumentAccessChecker,
    createSharedRowAccessChecker,
    type OrgRole,
} from "../../lib/access";
import { mapWithConcurrency } from "../../lib/concurrency";
import { selectAllByKey, selectInBatches, sortRows, uniqueIds } from "../../lib/batchedQuery";
import { type Db } from "../../lib/supabase";
import {
    resolvePlaybookRoles,
    type PlaybookAccessRow,
} from "../../modules/playbooks/playbooks.service";
import {
    filterReadableChatMessages,
    filterReadableReviewRows,
    loadReviewRows,
    selectCompleteChatMessages,
    withReadableTitles,
} from "../../lib/tabularReadAccess";


function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

export function userExportFilename(
    kind: "account" | "chats" | "tabular-reviews",
    userId: string,
    orgId: string | null = null,
) {
    const workspace = orgId ? `-org-${orgId.slice(0, 8)}` : "";
    return `litt-${kind}-export-${userId.slice(0, 8)}${workspace}-${nowStamp()}.json`;
}

type Row = Record<string, unknown>;

type ReadOptions = {
    /** Narrows the builder; no `order`/`limit` — paging adds them. */
    filter?: (query: any) => any;
    /** Must include `id`, the paging key. */
    columns?: string;
    /** The order the export promises, applied after the complete read. */
    order?: string[];
};

/**
 * Every row of `table` the filter matches. Keyset-paged on `id` to an empty
 * page: the `.range` loop this replaced stopped on a short page, which a
 * gateway configured below the page size returns long before the end.
 */
async function selectAll(
    db: Db,
    table: string,
    { filter = (query) => query, columns = "*", order = [] }: ReadOptions = {},
): Promise<Row[]> {
    const rows = await selectAllByKey<Row>(`export ${table}`, () =>
        filter((db as any).from(table).select(columns)),
    );
    return sortRows(rows, ...order);
}

/** Rows whose `column` is one of `ids`: URL-safe id batches, each paged. */
async function selectByIds(
    db: Db,
    table: string,
    column: string,
    ids: string[],
    { filter = (query) => query, columns = "*", order = ["created_at"] }: ReadOptions = {},
): Promise<Row[]> {
    const rows = await selectInBatches<Row>(`export ${table}`, ids, (batch) =>
        selectAllByKey<Row>(`export ${table}`, () =>
            filter((db as any).from(table).select(columns).in(column, batch)),
        ),
    );
    return sortRows(rows, ...order);
}

/**
 * The workspace an export covers: an organization's id, or null for
 * Personal. Settings exports one workspace at a time; a row is in it as
 * public.workspace_matches decides, by its org_id.
 */
type ExportWorkspace = string | null;

function inWorkspace(query: any, orgId: ExportWorkspace, column = "org_id") {
    return orgId ? query.eq(column, orgId) : query.is(column, null);
}

function rowInWorkspace(row: Row, orgId: ExportWorkspace) {
    return (typeof row.org_id === "string" ? row.org_id : null) === orgId;
}

function idsFrom(rows: Row[], column = "id"): string[] {
    return uniqueIds(
        rows.map((row) =>
            typeof row[column] === "string" ? (row[column] as string) : null,
        ),
    );
}

type ExportResourceRow = Row & {
    id: string;
    user_id: string | null;
    project_id: string | null;
    org_id?: string | null;
    workflow_id?: string | null;
    archived_at?: string | null;
};

/**
 * Export jobs use the service-role client. Creator provenance only chooses
 * candidates; normal read permissions decide which content may leave the app.
 * Check at build time, since membership or sharing may change while queued.
 */
async function readableRows(
    rows: Row[],
    authorize: (row: ExportResourceRow) => Promise<{ ok: boolean }>,
): Promise<Row[]> {
    const allowed = await mapWithConcurrency(rows, 8, async (row) =>
        typeof row.id === "string" && !row.archived_at
            ? (await authorize(row as ExportResourceRow)).ok
            : false,
    );
    return rows.filter((_, index) => allowed[index]);
}

/**
 * Cells of reviews the caller may open, narrowed to the rows whose source
 * documents the caller can read right now. Review access is not document
 * access: a review can be built from another project's documents, and its
 * cells hold text extracted from them. GET /tabular-review/:id and the review
 * chat apply the same rule (filterReadableReviewRows); the export, which reads
 * through the service role and may run long after it was queued, must not be
 * the one path that still carries those cells out.
 */
async function loadReadableReviewCells(
    db: Db,
    reviewIds: string[],
    userId: string,
    userEmail?: string | null,
) {
    if (reviewIds.length === 0) return [];
    const rowsByReview = await mapWithConcurrency(reviewIds, 8, (reviewId) =>
        loadReviewRows(db, reviewId),
    );
    const { rows } = await filterReadableReviewRows(
        db,
        rowsByReview.flat(),
        [],
        userId,
        userEmail,
    );
    const visibleRowIds = new Set(rows.map((row) => row.id));
    const cells = await selectByIds(db, "tabular_cells", "review_id", reviewIds);
    return cells.filter(
        (cell) =>
            typeof cell.row_id === "string" && visibleRowIds.has(cell.row_id),
    );
}

/**
 * Transcripts of review chats the caller may list, narrowed per message to
 * the source documents the caller can read now — the rule GET
 * /tabular-review/:id/chats/:chatId/messages applies. A transcript can carry
 * text derived from another project's documents; review access alone must
 * not carry it out (see lib/tabularReadAccess.ts).
 */
async function loadReadableTabularTranscripts(
    db: Db,
    chats: Record<string, unknown>[],
    userId: string,
    userEmail?: string | null,
) {
    const all = await selectCompleteChatMessages(db, idsFrom(chats), "*");
    const messages = await filterReadableChatMessages(
        db,
        all,
        userId,
        userEmail,
    );
    return { chats: withReadableTitles(chats, all, messages), messages };
}

async function loadUserReviews(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    const reviews = await selectAll(db, "tabular_reviews", {
        filter: (query) => inWorkspace(query.eq("user_id", userId), orgId),
        order: ["created_at"],
    });
    return readableRows(
        reviews,
        createSharedRowAccessChecker("tabular_review", userId, userEmail, db),
    );
}

async function loadUserChats(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    const candidates = await selectAll(db, "chats", {
        filter: (query) => inWorkspace(query.eq("user_id", userId), orgId),
        order: ["created_at"],
    });
    const chats = await readableRows(
        candidates,
        createSharedRowAccessChecker("chat", userId, userEmail, db),
    );
    const chatIds = idsFrom(chats);
    const messages = await selectByIds(db, "chat_messages", "chat_id", chatIds);
    return { chats, messages };
}

async function loadUserWordChats(db: Db, userId: string) {
    const documents = await selectAll(db, "word_documents", {
        filter: (query) => query.eq("user_id", userId),
        order: ["created_at"],
    });
    const chats = await selectAll(db, "word_chats", {
        filter: (query) => query.eq("user_id", userId),
        order: ["created_at"],
    });
    const messages = await selectByIds(
        db,
        "word_chat_messages",
        "chat_id",
        idsFrom(chats),
    );
    return { documents, chats, messages };
}

async function loadUserTabularChats(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    const candidates = await selectAll(db, "tabular_review_chats", {
        filter: (query) => query.eq("user_id", userId),
        order: ["created_at"],
    });
    // A review chat retains its creator after that person leaves the team.
    // Its parent review, not that creator id, controls access to the transcript.
    const reviews = await selectByIds(
        db,
        "tabular_reviews",
        "id",
        idsFrom(candidates, "review_id"),
    );
    // A review chat is in its review's workspace.
    const readableReviews = await readableRows(
        reviews.filter((review) => rowInWorkspace(review, orgId)),
        createSharedRowAccessChecker("tabular_review", userId, userEmail, db),
    );
    const reviewIds = new Set(idsFrom(readableReviews));
    return loadReadableTabularTranscripts(
        db,
        candidates.filter(
            (chat) =>
                typeof chat.review_id === "string" &&
                reviewIds.has(chat.review_id),
        ),
        userId,
        userEmail,
    );
}

/**
 * The playbooks this user created, the reviews they ran, and their imports.
 *
 * Playbook access is decided by resolvePlaybookRoles, the same rule the
 * playbooks list uses: an organization's playbook needs current membership,
 * even for its creator. A run's rules snapshot (`content_json`) is the
 * playbook's policy, so a run leaves only while its playbook can still be
 * opened, whoever created that playbook. The supplementary documents' text
 * stays behind like document bytes do; their metadata is listed.
 */
async function loadUserPlaybooks(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgMemberships: Row[],
    orgId: ExportWorkspace,
) {
    const orgRoles = new Map<string, OrgRole>();
    for (const row of orgMemberships) {
        if (typeof row.org_id === "string" && typeof row.role === "string")
            orgRoles.set(row.org_id, row.role as OrgRole);
    }

    const [created, runCandidates, imports] = await Promise.all([
        selectAll(db, "playbooks", {
            filter: (query) => query.eq("user_id", userId),
            order: ["created_at"],
        }),
        selectAll(db, "playbook_runs", {
            filter: (query) => query.eq("user_id", userId),
            order: ["started_at"],
        }),
        selectAll(db, "playbook_imports", {
            filter: (query) => query.eq("user_id", userId),
            order: ["started_at"],
        }),
    ]);
    const createdIds = new Set(idsFrom(created));
    const runPlaybooks = await selectByIds(
        db,
        "playbooks",
        "id",
        idsFrom(runCandidates, "playbook_id").filter((id) => !createdIds.has(id)),
    );
    const roles = await resolvePlaybookRoles(
        db,
        [...created, ...runPlaybooks] as PlaybookAccessRow[],
        userId,
        userEmail,
        orgRoles,
    );
    // A run is in its playbook's workspace.
    const inScope = new Set(
        idsFrom(
            [...created, ...runPlaybooks].filter(
                (row) => roles.has(row.id as string) && rowInWorkspace(row, orgId),
            ),
        ),
    );
    const playbooks = created.filter((row) => inScope.has(row.id as string));
    const [sources, changes] = await Promise.all([
        selectByIds(db, "playbook_sources", "playbook_id", idsFrom(playbooks), {
            columns: "id, playbook_id, filename, file_type, size_bytes, text_length, created_at",
        }),
        // LiTT: the changes proposed for the user's playbooks and their
        // decisions, as the playbooks themselves are exported.
        selectByIds(db, "playbook_changes", "playbook_id", idsFrom(playbooks)),
    ]);

    return {
        playbooks,
        playbook_sources: sources,
        playbook_changes: changes,
        playbook_runs: runCandidates.filter(
            (row) =>
                typeof row.playbook_id === "string" &&
                inScope.has(row.playbook_id),
        ),
        // Import records are metadata (file name, stage, error); one made in
        // an organization the user has left stays with that organization.
        playbook_imports: imports.filter(
            (row) =>
                rowInWorkspace(row, orgId) &&
                (typeof row.org_id !== "string" || orgRoles.has(row.org_id)),
        ),
    };
}

async function loadApiKeyStatus(db: Db, userId: string) {
    const rows = await selectAll(db, "user_api_keys", {
        filter: (query) => query.eq("user_id", userId),
        // Never the key material (encrypted_key, iv, auth_tag): only what
        // the user can already see in Settings.
        columns: "id, provider, settings, enabled, created_at, updated_at",
        order: ["provider"],
    });
    return rows.map((row) => ({
        provider: row.provider,
        has_key: true,
        // A disabled provider keeps its key; enabled defaults to true.
        enabled: row.enabled !== false,
        // The non-secret region/endpoint/location/base URL saved with it.
        settings: row.settings ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }));
}

/** What the export says it covers: Personal, or the organization's id. */
function workspaceLabel(orgId: ExportWorkspace) {
    return orgId ? { organization_id: orgId } : { personal: true };
}

export async function buildUserChatsExport(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    const [assistant, wordAddin, tabular] = await Promise.all([
        loadUserChats(db, userId, userEmail, orgId),
        // The Word add-in works in Personal only.
        orgId
            ? Promise.resolve({ documents: [], chats: [], messages: [] })
            : loadUserWordChats(db, userId),
        loadUserTabularChats(db, userId, userEmail, orgId),
    ]);

    return {
        exported_at: new Date().toISOString(),
        user: { id: userId, email: userEmail ?? null },
        workspace: workspaceLabel(orgId),
        assistant_chats: assistant,
        word_addin_chats: wordAddin,
        tabular_review_chats: tabular,
    };
}

export async function buildUserTabularReviewsExport(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    const tabularReviews = await loadUserReviews(db, userId, userEmail, orgId);
    const reviewIds = idsFrom(tabularReviews);

    const [cells, chats] = await Promise.all([
        loadReadableReviewCells(db, reviewIds, userId, userEmail),
        selectByIds(db, "tabular_review_chats", "review_id", reviewIds),
    ]);
    const transcript = await loadReadableTabularTranscripts(
        db,
        chats,
        userId,
        userEmail,
    );

    return {
        exported_at: new Date().toISOString(),
        user: { id: userId, email: userEmail ?? null },
        workspace: workspaceLabel(orgId),
        tabular_reviews: tabularReviews,
        tabular_cells: cells,
        tabular_review_chats: transcript,
    };
}

/**
 * The account JSON for one workspace. Personal's carries the account itself
 * as well — profile, keys, preferences, the organizations the person belongs
 * to — and Personal's content; an organization's carries only the person's
 * work in it.
 */
/**
 * Every `training_*` table of the schema is either carried by the account
 * export (under `training.<key>`) or left out with a reason. The test
 * `buildJsonExport.trainingCoverage.test.ts` finds the tables in the schema
 * and fails when one is in neither list, so a new learning table cannot ship
 * without a decision about the holder's right of access.
 */
export const TRAINING_EXPORT_KEYS = {
    training_mentors: "mentor_designations",
    training_pupils: "as_pupil",
    training_stages: "stages",
    training_turn_notes: "turn_notes",
    training_work_reviews: "work_reviews",
    training_defenses: "defenses",
    training_urgency_passes: "urgency_passes",
    training_backing_checks: "backing_checks",
    training_review_audits: "review_audits",
    training_readings: "readings",
    training_retakes: "retakes",
    training_criteria_contrasts: "criteria_contrasts",
    training_gym_attempts: "gym_attempts",
    training_gym_cases: "gym_cases",
} as const;

/**
 * Exported tables that hold a mentor's own content, not a person's learning:
 * they are found by author (`created_by`), outlive the membership and lose
 * their author when the account is erased.
 */
export const TRAINING_EXPORT_AUTHORED: readonly string[] = ["training_gym_cases"];

export const TRAINING_EXPORT_EXCLUDED: Record<string, string> = {
    training_version_approvals:
        "Insert-only evidence about a document version (document_version_id, content hash, approver), not learning data of the holder: it has no trainee column, hangs from no membership and records another person's decision. The holder's sealed drafts are in their documents.",
};

export async function buildUserAccountExport(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    // Account-level data has no workspace; it leaves with Personal's export.
    const personalOnly = <T>(load: () => Promise<T>, empty: T): Promise<T> =>
        orgId ? Promise.resolve(empty) : load();
    const normalizedEmail = userEmail?.trim().toLowerCase();
    const [
        profile,
        apiKeys,
        routerModels,
        projects,
        standaloneDocuments,
        workflows,
        defaultWorkflowInstallations,
        quickActions,
        workflowOpenSourceSubmissions,
        hiddenWorkflows,
        workflowSharesByUser,
        workflowSharesWithUser,
        assistantChats,
        tabularChats,
        tabularReviews,
        sharedProjects,
        sharedTabularReviews,
        auditEvents,
        appMemory,
    ] = await Promise.all([
        personalOnly(
            () => selectAll(db, "user_profiles", { filter: (query) => query.eq("user_id", userId) }),
            [],
        ),
        personalOnly(() => loadApiKeyStatus(db, userId), null),
        personalOnly(
            () =>
                selectAll(db, "user_router_models", {
                    filter: (query) => query.eq("user_id", userId),
                    order: ["router", "sort_order"],
                }),
            [],
        ),
        selectAll(db, "projects", {
            filter: (query) => inWorkspace(query.eq("user_id", userId), orgId),
            order: ["created_at"],
        }).then((rows) =>
            readableRows(rows, (row) =>
                checkProjectAccess(row.id, userId, userEmail, db),
            ),
        ),
        selectAll(db, "documents", {
            filter: (query) =>
                inWorkspace(query.eq("user_id", userId).is("project_id", null), orgId),
            order: ["created_at"],
        }),
        selectAll(db, "workflows", {
            filter: (query) => inWorkspace(query.eq("user_id", userId), orgId),
            order: ["created_at"],
        }).then((rows) =>
            readableRows(rows, (row) =>
                checkWorkflowAccess(row.id, userId, userEmail, db),
            ),
        ),
        personalOnly(
            () =>
                selectAll(db, "default_workflow_installations", {
                    filter: (query) => query.eq("user_id", userId),
                    order: ["installed_at"],
                }),
            [],
        ),
        personalOnly(
            () =>
                selectAll(db, "quick_actions", {
                    filter: (query) => query.eq("user_id", userId),
                    order: ["sort_order"],
                }),
            [],
        ),
        personalOnly(
            () =>
                selectAll(db, "workflow_open_source_submissions", {
                    filter: (query) => query.eq("submitted_by_user_id", userId),
                    order: ["submitted_at"],
                }),
            [],
        ),
        personalOnly(
            () =>
                selectAll(db, "hidden_workflows", {
                    filter: (query) => query.eq("user_id", userId),
                    order: ["created_at"],
                }),
            [],
        ),
        // Narrowed to the exported workflows below.
        selectAll(db, "workflow_shares", {
            filter: (query) => query.eq("shared_by_user_id", userId),
            order: ["created_at"],
        }),
        userEmail
            ? personalOnly(
                  () =>
                      selectAll(db, "workflow_shares", {
                          filter: (query) => query.eq("shared_with_email", userEmail),
                          order: ["created_at"],
                      }),
                  [],
              )
            : Promise.resolve([]),
        loadUserChats(db, userId, userEmail, orgId),
        loadUserTabularChats(db, userId, userEmail, orgId),
        loadUserReviews(db, userId, userEmail, orgId),
        normalizedEmail
            ? (async () => {
                  // Grants are candidates too: stale grants cannot override
                  // current organization membership or resource permissions.
                  const grantRows = await selectAll(db, "project_access_grants", {
                      filter: (query) => query.eq("email", normalizedEmail),
                      columns: "id, project_id",
                  });
                  const projectIds = idsFrom(grantRows, "project_id");
                  if (projectIds.length === 0) return [];
                  return selectByIds(db, "projects", "id", projectIds, {
                      filter: (query) => inWorkspace(query.neq("user_id", userId), orgId),
                      columns: "id, user_id, org_id, name, cm_number, created_at, updated_at",
                  }).then(async (rows) => {
                      const readable = await readableRows(rows, (row) =>
                          checkProjectAccess(row.id, userId, userEmail, db),
                      );
                      return readable.map(({ org_id: _org, ...row }) => row);
                  });
              })()
            : Promise.resolve([]),
        normalizedEmail
            ? (async () => {
                  const grantRows = await selectAll(db, "tabular_review_access_grants", {
                      filter: (query) => query.eq("email", normalizedEmail),
                      columns: "id, tabular_review_id",
                  });
                  const reviewIds = idsFrom(grantRows, "tabular_review_id");
                  if (reviewIds.length === 0) return [];
                  return selectByIds(db, "tabular_reviews", "id", reviewIds, {
                      filter: (query) => query.neq("user_id", userId),
                      columns: "id, user_id, project_id, org_id, archived_at, title, practice, created_at, updated_at",
                  }).then(async (rows) => {
                      const readable = await readableRows(
                          rows.filter((row) => rowInWorkspace(row, orgId)),
                          createSharedRowAccessChecker("tabular_review", userId, userEmail, db),
                      );
                      return readable.map(
                          ({ org_id: _org, archived_at: _archive, ...row }) => row,
                      );
                  });
              })()
            : Promise.resolve([]),
        selectAll(db, "audit_events", {
            filter: (query) => inWorkspace(query.eq("user_id", userId), orgId),
            order: ["created_at"],
        }),
        loadMemoryExport(db, "user", userId, orgId),
    ]);

    // Organization membership + the orgs the user belongs to and the
    // invitations addressed to them, for a complete GDPR-style export of
    // their multi-tenant footprint.
    const orgMemberships = await selectAll(db, "org_members", {
        filter: (query) => query.eq("user_id", userId),
        order: ["created_at"],
    });
    const orgIds = idsFrom(orgMemberships, "org_id");
    const [organizations, orgInvitations] = await Promise.all([
        personalOnly(() => selectByIds(db, "organizations", "id", orgIds), []),
        normalizedEmail
            ? personalOnly(
                  () =>
                      selectAll(db, "org_invitations", {
                          filter: (query) => query.eq("email", normalizedEmail),
                          order: ["created_at"],
                      }),
                  [],
              )
            : Promise.resolve([]),
    ]);

    // The holder's own training (docs/training.md): who mentors them and
    // their stage per practice area, in each organization (in one, for an
    // organization's export), with the private notes of their own turns and
    // what their mentor keeps about them (layer 2: work reviews, defenses,
    // urgency passes). Their pupils are other people's data, and so is the
    // mentor's credential reference.
    const trainingScope = (query: any) => (orgId ? query.eq("org_id", orgId) : query);
    const [
        trainingMentor,
        trainingPupil,
        trainingStages,
        trainingNotes,
        trainingWorkReviews,
        trainingDefenses,
        trainingUrgencyPasses,
        trainingBackingChecks,
        trainingReviewAudits,
        trainingReadings,
        trainingRetakes,
        trainingCriteriaContrasts,
        trainingGymAttempts,
        trainingGymCases,
    ] = await Promise.all([
        // These two have no `id`: their key is (org_id, person), so for one
        // person org_id is the unique paging key.
        selectAllByKey<Row>("export training_mentors", () =>
            trainingScope(
                (db as any)
                    .from("training_mentors")
                    .select("org_id, user_id, created_at")
                    .eq("user_id", userId),
            ),
            "org_id",
        ).then((rows) => sortRows(rows, "created_at", "org_id")),
        selectAllByKey<Row>("export training_pupils", () =>
            trainingScope(
                (db as any)
                    .from("training_pupils")
                    .select("org_id, trainee_user_id, mentor_user_id, created_at, updated_at")
                    .eq("trainee_user_id", userId),
            ),
            "org_id",
        ).then((rows) => sortRows(rows, "created_at", "org_id")),
        selectAll(db, "training_stages", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns: "id, org_id, trainee_user_id, practice, stage, updated_at",
            order: ["updated_at"],
        }),
        selectAll(db, "training_turn_notes", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, chat_id, word_chat_id, tabular_chat_id, message_id, attempt, contrast, contrast_status, created_at, confidence, verdict, verdict_source, foundation, foundation_question, topics, answer_unverified, mode, step",
            order: ["created_at"],
        }),
        selectAll(db, "training_work_reviews", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, chat_id, word_chat_id, tabular_chat_id, status, covered_through, proposed, ai_corrected, doubts, unverified, signals, model_provider, model, generated_at, reviewed_at, created_at, updated_at",
            order: ["created_at"],
        }),
        // A defense's questions reach the holder once its outcome is
        // recorded, as in the app: before that, only that it is scheduled.
        selectAll(db, "training_defenses", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, practice, work_review_id, questions_status, questions, model_provider, model, outcome, outcome_reason, outcome_note, held_at, created_at, updated_at",
            order: ["created_at"],
        }).then((rows) =>
            rows.map((row) => (row.outcome == null ? { ...row, questions: null } : row)),
        ),
        selectAll(db, "training_urgency_passes", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, project_id, starts_at, expires_at, reason_code, reason_note, revoked_at, created_at",
            order: ["created_at"],
        }),
        // Layer 3: the conclusions of the holder's answers as a junior, the
        // status the server computed and their own marks and notes.
        selectAll(db, "training_backing_checks", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, chat_id, word_chat_id, tabular_chat_id, message_id, status, conclusions, created_at, updated_at",
            order: ["created_at"],
        }),
        // Layer 3, bulk review designer: the holder's audits (marks and notes,
        // never cell content, which the row does not keep).
        selectAll(db, "training_review_audits", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, tabular_review_id, columns_snapshot, lint, sample, status, completed_at, mentor_outcome, mentor_note, evaluated_at, created_at",
            order: ["created_at"],
        }),
        // Periodic full readings (layer 3): what the holder wrote and what the
        // machine found, never the credential reference of the route.
        selectAll(db, "training_readings", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, project_id, document_id, version_id, swapped, status, findings, submitted_at, machine_findings, comparison, model_provider, model, created_at, updated_at",
            order: ["created_at"],
        }),
        // Own map and retake (layer 3): the question, the holder's answer and its
        // contrast, and the ids of the turn notes (exported above, with their own ids)
        // the question came from. The map itself is computed from the turn notes above. Never
        // the credential reference of the route.
        selectAll(db, "training_retakes", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, topic_key, topic_label, status, question, answer, contrast, verdict, source_note_ids, model_provider, model, created_at, updated_at, answered_at",
            order: ["created_at"],
        }),
        // Criteria contrasts (layer 3): the routes the two subagents ran on
        // (identifiers), the two analyses and the holder's explanation with
        // the comparison. No mentor id is in the row.
        selectAll(db, "training_criteria_contrasts", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, chat_id, message_id, routes, briefs, status, person_explanation, comparison, created_at, updated_at",
            order: ["created_at"],
        }),
        // Gym (layer 4): the attempts are the holder's learning data (the copy of the
        // case with its seeded errors, their findings and the hints they asked for);
        // the cases are the mentor's own content.
        selectAll(db, "training_gym_attempts", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, case_id, title, practice, paragraphs, errors, time_limit_minutes, status, started_at, deadline_at, submitted_at, findings, hints_used, created_at, updated_at",
            order: ["created_at"],
        }),
        selectAll(db, "training_gym_cases", {
            filter: (query) => trainingScope(query.eq("created_by", userId)),
            columns: "id, org_id, practice, title, paragraphs, errors, time_limit_minutes, fictitious, created_at, updated_at",
            order: ["created_at"],
        }),
    ]);

    const playbooks = await loadUserPlaybooks(
        db,
        userId,
        userEmail,
        orgMemberships,
        orgId,
    );
    const exportedWorkflowIds = new Set(idsFrom(workflows));

    const projectIds = idsFrom(projects);
    const projectDocuments = await selectByIds(
        db,
        "documents",
        "project_id",
        projectIds,
    );
    const documents = await readableRows(
        [...standaloneDocuments, ...projectDocuments],
        createDocumentAccessChecker(userId, userEmail, db),
    );
    const documentIds = idsFrom(documents);
    const reviewIds = idsFrom(tabularReviews);

    const [folders, versions, edits, tabularCells] = await Promise.all([
        selectByIds(db, "project_subfolders", "project_id", projectIds),
        selectByIds(db, "document_versions", "document_id", documentIds),
        selectByIds(db, "document_edits", "document_id", documentIds),
        selectByIds(db, "tabular_cells", "review_id", reviewIds),
    ]);

    return {
        exported_at: new Date().toISOString(),
        user: { id: userId, email: userEmail ?? null },
        workspace: workspaceLabel(orgId),
        ...(orgId
            ? {}
            : {
                  profile,
                  api_keys: apiKeys,
                  router_models: routerModels,
                  organizations,
                  org_members: orgMemberships,
                  org_invitations: orgInvitations,
                  default_workflow_installations: defaultWorkflowInstallations,
                  quick_actions: quickActions,
                  workflow_open_source_submissions:
                      workflowOpenSourceSubmissions,
                  hidden_workflows: hiddenWorkflows,
                  workflow_shares_with_user: workflowSharesWithUser,
              }),
        projects,
        project_subfolders: folders,
        documents,
        document_versions: versions,
        document_edits: edits,
        workflows,
        workflow_shares_by_user: workflowSharesByUser.filter(
            (row) =>
                typeof row.workflow_id === "string" &&
                exportedWorkflowIds.has(row.workflow_id),
        ),
        chats: assistantChats,
        tabular_reviews: tabularReviews,
        tabular_cells: tabularCells,
        tabular_review_chats: tabularChats,
        ...playbooks,
        shared_access: {
            projects: sharedProjects,
            tabular_reviews: sharedTabularReviews,
        },
        memory: appMemory,
        training: {
            [TRAINING_EXPORT_KEYS.training_mentors]: trainingMentor,
            [TRAINING_EXPORT_KEYS.training_pupils]: trainingPupil,
            [TRAINING_EXPORT_KEYS.training_stages]: trainingStages,
            [TRAINING_EXPORT_KEYS.training_turn_notes]: trainingNotes,
            [TRAINING_EXPORT_KEYS.training_work_reviews]: trainingWorkReviews,
            [TRAINING_EXPORT_KEYS.training_defenses]: trainingDefenses,
            [TRAINING_EXPORT_KEYS.training_urgency_passes]: trainingUrgencyPasses,
            [TRAINING_EXPORT_KEYS.training_backing_checks]: trainingBackingChecks,
            [TRAINING_EXPORT_KEYS.training_review_audits]: trainingReviewAudits,
            [TRAINING_EXPORT_KEYS.training_readings]: trainingReadings,
            [TRAINING_EXPORT_KEYS.training_retakes]: trainingRetakes,
            [TRAINING_EXPORT_KEYS.training_criteria_contrasts]: trainingCriteriaContrasts,
            [TRAINING_EXPORT_KEYS.training_gym_attempts]: trainingGymAttempts,
            [TRAINING_EXPORT_KEYS.training_gym_cases]: trainingGymCases,
        },
        audit_events: auditEvents,
    };
}

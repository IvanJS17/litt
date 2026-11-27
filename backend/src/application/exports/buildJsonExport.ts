import { loadMemoryExport } from "../../lib/memory/export";
import {
    checkProjectAccess,
    checkWorkflowAccess,
    createDocumentAccessChecker,
    createSharedRowAccessChecker,
    keepReadableDerived,
    type OrgRole,
} from "../../lib/access";
import { readableChatMessages } from "../../lib/chatReadAccess";
import { mapWithConcurrency } from "../../lib/concurrency";
import { selectAllByKey, selectInBatches, sortRows, uniqueIds } from "../../lib/batchedQuery";
import { type Db } from "../../lib/supabase";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "../../lib/trainingNotes";
import { judgeWorkMatters, openMatters, workKey } from "../../lib/trainingWork";
import { loadUserObligationEvents, loadUserProfileFacts, loadUserRadarEvents, loadUserReportSentEvents, loadUserRuleSuggestions } from "./matterProfileExport";
import { loadUserMatterRequests } from "./matterRequestsExport";
import {
    resolvePlaybookRoles,
    withholdUnreadableRunRows,
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
    return (await loadReadableTabularTranscriptsJudged(db, chats, userId, userEmail)).result;
}

async function loadReadableTabularTranscriptsJudged(
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
    return {
        result: { chats: withReadableTitles(chats, all, messages), messages },
        judged: judgeChats(all, messages),
    };
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
    return (await loadUserChatsJudged(db, userId, userEmail, orgId)).result;
}

/** The holder's chats as exported, with the verdict on each message that training records follow. */
async function loadUserChatsJudged(
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
    const all = await selectByIds(db, "chat_messages", "chat_id", chatIds);
    // Chat access is not document access: an answer that quotes a document the
    // holder can no longer open, or the attachment itself, stays behind; what
    // the holder typed stays. A chat with anything withheld loses its title,
    // which was written from the chat.
    const { messages, withheld } = await readableChatMessages(db, { userId, userEmail }, all, "chat_messages");
    return {
        result: {
            chats: chats.map((chat) => (withheld.has(chat.id as string) ? { ...chat, title: null } : chat)),
            messages,
        },
        judged: judgeChats(all, messages),
    };
}

/** The holder's Word chats as exported, with the verdict on each message that training records follow. */
async function loadUserWordChatsJudged(db: Db, userId: string, userEmail: string | null | undefined) {
    const documents = await selectAll(db, "word_documents", {
        filter: (query) => query.eq("user_id", userId),
        order: ["created_at"],
    });
    const chats = await selectAll(db, "word_chats", {
        filter: (query) => query.eq("user_id", userId),
        order: ["created_at"],
    });
    const all = await selectByIds(db, "word_chat_messages", "chat_id", idsFrom(chats));
    // Judged as any chat is: an answer drawn from a document the holder can no
    // longer open stays behind, and so does the title of a chat with anything
    // withheld.
    const { messages, withheld } = await readableChatMessages(db, { userId, userEmail }, all, "word_chat_messages");
    return {
        result: {
            documents,
            chats: chats.map((chat) => (withheld.has(chat.id as string) ? { ...chat, title: null } : chat)),
            messages,
        },
        judged: judgeChats(all, messages),
    };
}

async function loadUserTabularChats(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    orgId: ExportWorkspace,
) {
    return (await loadUserTabularChatsJudged(db, userId, userEmail, orgId)).result;
}

async function loadUserTabularChatsJudged(
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
    return loadReadableTabularTranscriptsJudged(
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
        // A run quotes the document it reviewed: it leaves with the holder
        // only while the holder can open that document.
        playbook_runs: await withholdUnreadableRunRows(
            db,
            { userId, userEmail },
            runCandidates.filter(
                (row) =>
                    typeof row.playbook_id === "string" &&
                    inScope.has(row.playbook_id),
            ),
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
            : loadUserWordChatsJudged(db, userId, userEmail).then(({ result }) => result),
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

/** Per chat, its stored messages oldest first, each with whether the export withheld it. */
type ChatJudgement = Map<string, { id: string; role: unknown; withheld: boolean }[]>;

function judgeChats(all: Row[], readable: Row[], into: ChatJudgement = new Map()): ChatJudgement {
    const kept = new Set(idsFrom(readable));
    for (const message of all) {
        const chatId = message.chat_id as string;
        if (!into.has(chatId)) into.set(chatId, []);
        into.get(chatId)!.push({ id: message.id as string, role: message.role, withheld: !kept.has(message.id as string) });
    }
    return into;
}

/**
 * A training row made from a chat is made from its answers: from the answer of
 * its turn when it records the message, else from every answer of the chat.
 * It may leave only if those answers did. `message_id` is the person's own
 * message for a turn note (the answer is what follows it) and the answer
 * itself for a backing check or a criteria contrast.
 */
function madeFromReadableAnswers(judged: ChatJudgement, row: Row): boolean {
    const chatId = [row.chat_id, row.word_chat_id, row.tabular_chat_id].find((id): id is string => typeof id === "string");
    const messages = chatId ? judged.get(chatId) : undefined;
    // A chat with no stored message has no answer to withhold.
    if (!messages) return true;
    const at = messages.findIndex((message) => message.id === row.message_id);
    let answers = messages.filter((message) => message.role === "assistant");
    if (at >= 0 && messages[at].role === "assistant") answers = [messages[at]];
    else if (at >= 0) {
        // The person's message: the answers that follow it, up to their next message.
        answers = [];
        for (const message of messages.slice(at + 1)) {
            if (message.role === "user") break;
            if (message.role === "assistant") answers.push(message);
        }
    }
    return answers.every((message) => !message.withheld);
}

/** Judge the chats training rows name that the export did not list (archived, or of another workspace). */
async function judgeUnlistedChats(
    db: Db,
    judged: ChatJudgement,
    rows: Row[],
    reader: { userId: string; userEmail: string | null | undefined },
) {
    const wanted = (column: string) => uniqueIds(rows.map((row) => row[column]).filter((id): id is string => typeof id === "string" && !judged.has(id)));
    const [chatIds, wordIds, tabularIds] = [wanted("chat_id"), wanted("word_chat_id"), wanted("tabular_chat_id")];
    if (chatIds.length) {
        const all = await selectByIds(db, "chat_messages", "chat_id", chatIds);
        judgeChats(all, (await readableChatMessages(db, reader, all, "chat_messages")).messages, judged);
    }
    if (wordIds.length) {
        const all = await selectByIds(db, "word_chat_messages", "chat_id", wordIds);
        judgeChats(all, (await readableChatMessages(db, reader, all, "word_chat_messages")).messages, judged);
    }
    if (tabularIds.length) {
        const all = await selectCompleteChatMessages(db, tabularIds, "*");
        judgeChats(all, await filterReadableChatMessages(db, all, reader.userId, reader.userEmail), judged);
    }
    for (const id of [...chatIds, ...wordIds, ...tabularIds]) if (!judged.has(id)) judged.set(id, []);
}

/**
 * Work a person did inside a matter carries that matter's confidentiality
 * (lib/trainingWork.ts). A training row's matter is its own project, else the
 * project of its chat or tabular review; a row with no matter is the holder's
 * alone. Of `rows`, keep those whose matter the holder can open now, and
 * those with no matter. A row whose chat or review can no longer be found
 * cannot be placed, so it is withheld.
 */
async function openableTrainingRows(
    db: Db,
    rows: Row[],
    userId: string,
    userEmail: string | null | undefined,
): Promise<Row[]> {
    if (rows.length === 0) return rows;
    const GONE = Symbol("gone");
    const chatWorkOf = (row: Row): { surface: TurnNoteSurface; chatId: string } | null => {
        for (const [surface, column] of Object.entries(TURN_NOTE_CHAT_COLUMN) as [TurnNoteSurface, string][]) {
            const chatId = row[column];
            if (typeof chatId === "string") return { surface, chatId };
        }
        return null;
    };
    // The matter rule only: the export judges what a chat's answers drew on answer by answer, elsewhere.
    const sights = await judgeWorkMatters(
        db,
        rows.flatMap((row) => (typeof row.project_id === "string" ? [] : (chatWorkOf(row) ?? []))),
        { actorId: userId, actorEmail: userEmail ?? null },
    );
    const reviewMatters = new Map<string, Promise<string | null | typeof GONE>>();
    const reviewMatterOf = (reviewId: string) => {
        let pending = reviewMatters.get(reviewId);
        if (!pending)
            reviewMatters.set(
                reviewId,
                (pending = (async () => {
                    const { data, error } = await (db as any).from("tabular_reviews").select("id, project_id").eq("id", reviewId).maybeSingle();
                    if (error) throw error;
                    return data ? ((data.project_id as string | null) ?? null) : GONE;
                })()),
            );
        return pending;
    };
    const matters = await mapWithConcurrency(rows, 8, async (row): Promise<string | null | typeof GONE> => {
        if (typeof row.project_id === "string") return row.project_id;
        const work = chatWorkOf(row);
        if (work) return sights.get(workKey(work))?.open ? null : GONE;
        if (typeof row.tabular_review_id === "string") return reviewMatterOf(row.tabular_review_id);
        return null;
    });
    const openable = await openMatters(
        db,
        { actorId: userId, actorEmail: userEmail ?? null },
        uniqueIds(matters.filter((matter): matter is string => typeof matter === "string")),
    );
    return rows.filter((_, index) => {
        const matter = matters[index];
        return matter === null || (typeof matter === "string" && openable.has(matter));
    });
}

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
        assistantLoaded,
        tabularLoaded,
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
        loadUserChatsJudged(db, userId, userEmail, orgId),
        loadUserTabularChatsJudged(db, userId, userEmail, orgId),
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
        // the cases are the mentor's own content. `errors` is the answer key: it is
        // exported only once the attempt is submitted, never before (rule 7).
        selectAll(db, "training_gym_attempts", {
            filter: (query) => trainingScope(query.eq("trainee_user_id", userId)),
            columns:
                "id, org_id, case_id, title, practice, paragraphs, errors, time_limit_minutes, status, started_at, deadline_at, submitted_at, findings, hints_used, created_at, updated_at",
            order: ["created_at"],
        }).then((rows) => rows.map((row) => (row.status === "submitted" ? row : { ...row, errors: null }))),
        selectAll(db, "training_gym_cases", {
            filter: (query) => trainingScope(query.eq("created_by", userId)),
            columns: "id, org_id, practice, title, paragraphs, errors, time_limit_minutes, fictitious, created_at, updated_at",
            order: ["created_at"],
        }),
    ]);

    // The training rows made from a matter the holder can no longer open stay
    // behind, as that matter's chats, documents and requests do. So do those
    // made from a chat answer or a document the holder can no longer read: the
    // verdict on each chat message was reached once, with the chats above.
    const reader = { userId, userEmail };
    const judged: ChatJudgement = new Map([...assistantLoaded.judged, ...tabularLoaded.judged]);
    await judgeUnlistedChats(db, judged, [...trainingNotes, ...trainingWorkReviews, ...trainingBackingChecks, ...trainingCriteriaContrasts], reader);
    const keepOpenable = (rows: Row[]) => openableTrainingRows(db, rows, userId, userEmail);
    const keepFromChats = async (rows: Row[]) => (await keepOpenable(rows)).filter((row) => madeFromReadableAnswers(judged, row));
    const [
        turnNotes,
        workReviews,
        urgencyPasses,
        backingChecks,
        reviewAudits,
        openReadings,
        criteriaContrasts,
    ] = await Promise.all([
        keepFromChats(trainingNotes),
        keepFromChats(trainingWorkReviews),
        keepOpenable(trainingUrgencyPasses),
        keepFromChats(trainingBackingChecks),
        keepOpenable(trainingReviewAudits),
        keepOpenable(trainingReadings),
        keepFromChats(trainingCriteriaContrasts),
    ]);
    // A reading is of a document: through that document's access. One whose
    // document was deleted keeps what the person wrote and its result, not the
    // passages and comparison drawn from the document.
    const readings = (
        await keepReadableDerived(db, reader, openReadings, (row) =>
            typeof row.document_id === "string" ? [row.document_id] : [],
        )
    ).map((row) => (typeof row.document_id === "string" ? row : { ...row, machine_findings: null, comparison: null }));
    // A defense hangs from a work review: what was derived from a withheld
    // review goes with it, and from none recorded (a practice-area defense is
    // drawn from several works that are not recorded; a deleted review looks
    // the same). A retake is built from turn notes: one built from a withheld
    // note goes too; one whose notes no longer exist loses its question and
    // contrast but keeps the person's answer and its result.
    const keptReviewIds = new Set(idsFrom(workReviews));
    const defenses = trainingDefenses.map((row) =>
        typeof row.work_review_id === "string" && keptReviewIds.has(row.work_review_id)
            ? row
            : { ...row, questions: null, outcome_note: null },
    );
    const keptNoteIds = new Set(idsFrom(turnNotes));
    const allNoteIds = new Set(idsFrom(trainingNotes));
    const noteIdsOf = (row: Row) => (Array.isArray(row.source_note_ids) ? (row.source_note_ids as unknown[]) : []);
    const retakes = trainingRetakes
        .filter((row) => noteIdsOf(row).every((id) => typeof id !== "string" || !allNoteIds.has(id) || keptNoteIds.has(id)))
        .map((row) => {
            const ids = noteIdsOf(row);
            return ids.length > 0 && ids.every((id) => typeof id === "string" && allNoteIds.has(id))
                ? row
                : { ...row, question: null, contrast: null };
        });

    // Retainer requests that name the holder, in matters they can still open.
    const matterRequests = await loadUserMatterRequests(db, userId, userEmail, orgId);
    const profileFacts = await loadUserProfileFacts(db, userId, userEmail, orgId);
    const radarEvents = await loadUserRadarEvents(db, userId, userEmail, orgId);
    const obligationEvents = await loadUserObligationEvents(db, userId, userEmail, orgId);
    const reportSentEvents = await loadUserReportSentEvents(db, userId, userEmail, orgId);
    const ruleSuggestions = await loadUserRuleSuggestions(db, userId, userEmail, orgId);

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
        loadReadableReviewCells(db, reviewIds, userId, userEmail),
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
        chats: assistantLoaded.result,
        tabular_reviews: tabularReviews,
        tabular_cells: tabularCells,
        tabular_review_chats: tabularLoaded.result,
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
            [TRAINING_EXPORT_KEYS.training_turn_notes]: turnNotes,
            [TRAINING_EXPORT_KEYS.training_work_reviews]: workReviews,
            [TRAINING_EXPORT_KEYS.training_defenses]: defenses,
            [TRAINING_EXPORT_KEYS.training_urgency_passes]: urgencyPasses,
            [TRAINING_EXPORT_KEYS.training_backing_checks]: backingChecks,
            [TRAINING_EXPORT_KEYS.training_review_audits]: reviewAudits,
            [TRAINING_EXPORT_KEYS.training_readings]: readings,
            [TRAINING_EXPORT_KEYS.training_retakes]: retakes,
            [TRAINING_EXPORT_KEYS.training_criteria_contrasts]: criteriaContrasts,
            [TRAINING_EXPORT_KEYS.training_gym_attempts]: trainingGymAttempts,
            [TRAINING_EXPORT_KEYS.training_gym_cases]: trainingGymCases,
        },
        matter_requests: matterRequests.requests,
        matter_request_events: matterRequests.events,
        matter_profile_facts: profileFacts.facts,
        matter_profile_fact_events: profileFacts.events,
        matter_radar_item_events: radarEvents,
        matter_obligation_rule_events: obligationEvents.rules,
        matter_obligation_item_events: obligationEvents.items,
        matter_report_sent_events: reportSentEvents,
        obligation_rule_suggestions: ruleSuggestions.suggestions,
        obligation_rule_suggestion_events: ruleSuggestions.events,
        obligation_rule_questions: ruleSuggestions.questions,
        obligation_rule_question_answers: ruleSuggestions.answers,
        audit_events: auditEvents,
    };
}

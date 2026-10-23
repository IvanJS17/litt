import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../storage", () => ({
    assertStorageConfigured: vi.fn(),
    uploadFile: (...a: unknown[]) => uploadFile(...a),
    deleteFile: vi.fn(async () => {}),
    listFiles: vi.fn(async () => []),
    downloadFile: vi.fn(async () => null),
}));
vi.mock("../audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../audit")>()),
    recordAudit: vi.fn(async () => {}),
}));

import {
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
} from "../userDataExport";
import { handleExportBuild } from "../dbq/handlers";
import type { DbJob } from "../dbq/types";

type Row = Record<string, unknown>;

/**
 * Read-only fake for the query subset the export and the access helpers use
 * (select/range/order/eq/neq/in/is/maybeSingle/then). `failures` makes a table's
 * reads return an error so fail-closed behavior can be pinned. Like PostgREST,
 * every response is capped at `maxRows` rows and `range` selects a window.
 */
function makeDb(
    tables: Record<string, Row[]>,
    failures: Record<string, { message: string }> = {},
    maxRows = 1000,
) {
    function query(table: string) {
        let rows = [...(tables[table] ?? [])];
        const failure = failures[table];
        let window: [number, number] = [0, Infinity];
        let counted = false;
        const page = () => {
            const end = Math.min(window[1] + 1, window[0] + maxRows);
            return {
                data: rows.slice(window[0], end),
                error: null,
                count: counted ? rows.length : null,
            };
        };
        const builder: any = {
            select: (_columns?: string, options?: { count?: string }) => {
                counted = options?.count === "exact";
                return builder;
            },
            range: (from: number, to: number) => {
                window = [from, to];
                return builder;
            },
            order: () => builder,
            limit: () => builder,
            eq: (col: string, val: unknown) => {
                rows = rows.filter((r) => r[col] === val);
                return builder;
            },
            neq: (col: string, val: unknown) => {
                rows = rows.filter((r) => r[col] !== val);
                return builder;
            },
            is: (col: string, val: unknown) => {
                rows = rows.filter((r) => (r[col] ?? null) === val);
                return builder;
            },
            in: (col: string, vals: unknown[]) => {
                rows = rows.filter((r) => vals.includes(r[col]));
                return builder;
            },
            maybeSingle: async () =>
                failure
                    ? { data: null, error: failure }
                    : { data: rows[0] ?? null, error: null },
            single: async () =>
                failure
                    ? { data: null, error: failure }
                    : { data: rows[0] ?? null, error: null },
            then: (
                resolve: (v: any) => unknown,
                reject?: (e: any) => unknown,
            ) =>
                Promise.resolve(
                    failure ? { data: null, error: failure } : page(),
                ).then(resolve, reject),
        };
        return builder;
    }
    return { db: { from: (t: string) => query(t) } as any };
}

const userId = "departed-user";
const email = "departed@example.test";
const ids = (rows: Row[]) => rows.map((row) => row.id);

const resource = (id: string, fields: Row = {}): Row => ({
    id,
    user_id: userId,
    project_id: null,
    org_id: null,
    ...fields,
});

/**
 * LiTT revocation keeps the row: organization membership flips to `revoked`,
 * matter membership is removed, direct grants are deleted — and `user_id`
 * stays. Export runs on the service role, so provenance alone must not carry
 * the content out.
 */
function fixtures(): Record<string, Row[]> {
    const projects: Row[] = [
        { ...resource("project-personal"), name: "Personal" },
        { ...resource("project-current", { org_id: "current-org" }), name: "Matter" },
        { ...resource("project-departed", { org_id: "old-org" }), name: "Old firm matter" },
        {
            ...resource("project-private-matter", { org_id: "current-org" }),
            name: "Privileged matter",
        },
    ];
    const documents: Row[] = [
        resource("document-personal"),
        resource("document-current", { project_id: "project-current" }),
        resource("document-departed", { project_id: "project-departed" }),
        resource("document-private-matter", {
            project_id: "project-private-matter",
        }),
        resource("document-departed-workflow", {
            workflow_id: "workflow-departed",
            org_id: "old-org",
        }),
        resource("document-current-project", {
            project_id: "project-current",
            user_id: "colleague",
        }),
    ];
    const chats: Row[] = [
        { ...resource("chat-personal"), title: "Personal" },
        { ...resource("chat-current", { project_id: "project-current" }), title: "Matter" },
        { ...resource("chat-departed", { project_id: "project-departed" }), title: "Old" },
    ];
    const reviews: Row[] = [
        { ...resource("review-personal"), title: "Personal review" },
        { ...resource("review-current", { project_id: "project-current" }), title: "Matter review" },
        { ...resource("review-departed", { project_id: "project-departed" }), title: "Old review" },
    ];
    const threads: Row[] = reviews.map((review) => ({
        ...resource(`thread-${review.id}`),
        review_id: review.id,
        title: "Transcript",
    }));
    return {
        organizations: [{ id: "old-org" }, { id: "current-org" }],
        organization_memberships: [
            {
                id: "membership",
                organization_id: "current-org",
                user_id: userId,
                role: "editor",
                status: "active",
            },
        ],
        matters: [
            {
                id: "matter-private",
                project_id: "project-private-matter",
                visibility: "private",
            },
        ],
        matter_memberships: [],
        project_org_access_overrides: [],
        workflow_org_access_overrides: [],
        project_access_grants: [],
        tabular_review_access_grants: [],
        workflow_shares: [],
        projects,
        project_subfolders: projects.map((project) => ({
            id: `folder-${project.id}`,
            project_id: project.id,
        })),
        workflows: [
            resource("workflow-personal"),
            resource("workflow-current", { org_id: "current-org" }),
            resource("workflow-departed", { org_id: "old-org" }),
        ],
        documents,
        document_versions: documents.map((doc) => ({
            id: `version-${doc.id}`,
            document_id: doc.id,
        })),
        document_edits: documents.map((doc) => ({
            id: `edit-${doc.id}`,
            document_id: doc.id,
        })),
        chats,
        chat_messages: chats.map((chat) => ({
            id: `message-${chat.id}`,
            chat_id: chat.id,
        })),
        tabular_reviews: reviews,
        tabular_review_rows: reviews.map((review) => ({
            id: `row-${review.id}`,
            review_id: review.id,
            document_id: null,
            sort_index: 0,
        })),
        tabular_review_row_sources: [
            { row_id: "row-review-personal", document_id: "document-personal" },
            { row_id: "row-review-current", document_id: "document-current" },
            { row_id: "row-review-departed", document_id: "document-departed" },
        ],
        tabular_cells: reviews.map((review) => ({
            id: `cell-${review.id}`,
            review_id: review.id,
            row_id: `row-${review.id}`,
        })),
        tabular_review_chats: threads,
        tabular_review_chat_messages: threads.map((thread) => ({
            id: `message-${thread.id}`,
            chat_id: thread.id,
            source_document_ids: [
                `document-${String(thread.review_id).replace("review-", "")}`,
            ],
        })),
    };
}

describe("exports honor current read access", () => {
    it("leaves out departed, matter-private and denied content with its descendants", async () => {
        const { db } = makeDb(fixtures());

        const result = await buildUserAccountExport(db, userId, email);

        expect(ids(result.projects)).toEqual([
            "project-personal",
            "project-current",
        ]);
        expect(ids(result.project_subfolders)).toEqual([
            "folder-project-personal",
            "folder-project-current",
        ]);
        expect(ids(result.workflows)).toEqual([
            "workflow-personal",
            "workflow-current",
        ]);
        expect(ids(result.documents)).toEqual([
            "document-personal",
            "document-current",
            "document-current-project",
        ]);
        expect(ids(result.document_versions)).toEqual([
            "version-document-personal",
            "version-document-current",
            "version-document-current-project",
        ]);
        expect(ids(result.document_edits)).toEqual([
            "edit-document-personal",
            "edit-document-current",
            "edit-document-current-project",
        ]);
        expect(ids(result.chats.chats)).toEqual(["chat-personal", "chat-current"]);
        expect(ids(result.chats.messages)).toEqual([
            "message-chat-personal",
            "message-chat-current",
        ]);
        expect(ids(result.tabular_reviews)).toEqual([
            "review-personal",
            "review-current",
        ]);
        expect(ids(result.tabular_cells)).toEqual([
            "cell-review-personal",
            "cell-review-current",
        ]);
        expect(ids(result.tabular_review_chats.chats)).toEqual([
            "thread-review-personal",
            "thread-review-current",
        ]);
        expect(ids(result.tabular_review_chats.messages)).toEqual([
            "message-thread-review-personal",
            "message-thread-review-current",
        ]);
        expect(result.shared_access).toEqual({
            projects: [],
            tabular_reviews: [],
        });
    });

    it("applies the same rule to the chat-only and review-only exports", async () => {
        const { db } = makeDb(fixtures());

        const chats = await buildUserChatsExport(db, userId, email);
        const reviews = await buildUserTabularReviewsExport(db, userId, email);

        expect(ids(chats.assistant_chats.chats)).toEqual([
            "chat-personal",
            "chat-current",
        ]);
        expect(ids(chats.assistant_chats.messages)).toEqual([
            "message-chat-personal",
            "message-chat-current",
        ]);
        expect(ids(chats.tabular_review_chats.chats)).toEqual([
            "thread-review-personal",
            "thread-review-current",
        ]);
        expect(ids(reviews.tabular_reviews)).toEqual([
            "review-personal",
            "review-current",
        ]);
        expect(ids(reviews.tabular_cells)).toEqual([
            "cell-review-personal",
            "cell-review-current",
        ]);
        expect(ids(reviews.tabular_review_chats.chats)).toEqual([
            "thread-review-personal",
            "thread-review-current",
        ]);
        expect(ids(reviews.tabular_review_chats.messages)).toEqual([
            "message-thread-review-personal",
            "message-thread-review-current",
        ]);
    });

    it("drops a retained transcript once the grant on its review is revoked", async () => {
        const tables: Record<string, Row[]> = {
            tabular_reviews: [
                { id: "shared-review", user_id: "colleague", project_id: null },
            ],
            tabular_review_access_grants: [
                { tabular_review_id: "shared-review", email, role: "viewer" },
            ],
            tabular_review_chats: [
                {
                    id: "thread",
                    review_id: "shared-review",
                    user_id: userId,
                    title: "Team transcript",
                },
            ],
            tabular_review_chat_messages: [
                {
                    id: "message",
                    chat_id: "thread",
                    content: "Retained team discussion",
                    source_document_ids: [],
                },
            ],
        };
        const { db } = makeDb(tables);

        const before = await buildUserChatsExport(db, userId, email);
        expect(ids(before.tabular_review_chats.messages)).toEqual(["message"]);
        expect(
            ids((await buildUserAccountExport(db, userId, email)).shared_access.tabular_reviews),
        ).toEqual(["shared-review"]);

        // The review keeps its creator and the transcript keeps its author;
        // only the grant is gone.
        tables.tabular_review_access_grants = [];
        tables.tabular_review_chat_messages.push({
            id: "after-removal",
            chat_id: "thread",
            content: "Written after removal",
            source_document_ids: [],
        });

        const after = await buildUserChatsExport(db, userId, email);
        const account = await buildUserAccountExport(db, userId, email);
        expect(after.tabular_review_chats).toEqual({ chats: [], messages: [] });
        expect(account.tabular_review_chats).toEqual({
            chats: [],
            messages: [],
        });
        expect(account.shared_access.tabular_reviews).toEqual([]);
        expect(JSON.stringify(account)).not.toContain("Written after removal");
    });

    it("does not treat a stale direct grant as organization membership", async () => {
        const { db } = makeDb({
            projects: [
                {
                    id: "team-project",
                    user_id: "colleague",
                    org_id: "departed-org",
                    name: "Old firm matter",
                },
                {
                    id: "shared-personal",
                    user_id: "colleague",
                    org_id: null,
                    name: "Shared personal matter",
                },
            ],
            project_access_grants: [
                {
                    project_id: "team-project",
                    email,
                    role: "owner",
                },
                {
                    project_id: "shared-personal",
                    email,
                    role: "viewer",
                },
            ],
        });

        const result = await buildUserAccountExport(db, userId, email);

        // LiTT organization scope is exclusive: a grant cannot outlive the
        // membership it was layered on. Personal sharing still travels.
        expect(
            ids(result.shared_access.projects),
        ).toEqual(["shared-personal"]);
    });

    it("keeps personal data when the caller has no email, including Word transcripts", async () => {
        const { db } = makeDb({
            chats: [resource("personal-chat")],
            chat_messages: [{ id: "personal-message", chat_id: "personal-chat" }],
            word_documents: [resource("word-doc")],
            word_chats: [
                resource("word-chat", { word_document_id: "word-doc" }),
            ],
            word_chat_messages: [
                { id: "word-message", chat_id: "word-chat" },
            ],
        });

        const result = await buildUserChatsExport(db, userId);

        expect(ids(result.assistant_chats.messages)).toEqual([
            "personal-message",
        ]);
        expect(ids(result.word_addin_chats.messages)).toEqual(["word-message"]);
    });

    it("fails closed when organization membership cannot be read", async () => {
        const { db } = makeDb(fixtures(), {
            organization_memberships: { message: "unavailable" },
        });

        const result = await buildUserChatsExport(db, userId, email);

        expect(ids(result.assistant_chats.chats)).toEqual(["chat-personal"]);
        expect(ids(result.tabular_review_chats.chats)).toEqual([
            "thread-review-personal",
        ]);
    });
});

/**
 * A review in a matter the caller can still open may be built from another
 * matter's documents. Losing access to that other matter must take the rows
 * fed by its documents, and the extracted text in their cells, out of every
 * export — the review-only one, the account one, and the queued job that
 * builds either long after it was requested.
 */
describe("exports narrow review cells to readable source documents", () => {
    const SECRET = "SECRET FROM X";

    function crossProjectTables(): Record<string, Row[]> {
        return {
            projects: [
                { id: "project-y", user_id: userId, org_id: null, name: "Y" },
                { id: "project-x", user_id: "colleague", org_id: null, name: "X" },
            ],
            project_access_grants: [
                { project_id: "project-x", email, role: "viewer" },
            ],
            documents: [
                { id: "doc-y", user_id: userId, project_id: "project-y", org_id: null },
                { id: "doc-x", user_id: "colleague", project_id: "project-x", org_id: null },
            ],
            tabular_reviews: [
                { id: "review-y", user_id: userId, project_id: "project-y", org_id: null },
            ],
            tabular_review_rows: [
                { id: "row-y", review_id: "review-y", document_id: "doc-y", sort_index: 0 },
                { id: "row-x", review_id: "review-y", document_id: "doc-x", sort_index: 1 },
                { id: "row-mixed", review_id: "review-y", document_id: null, sort_index: 2 },
            ],
            tabular_review_row_sources: [
                { row_id: "row-y", document_id: "doc-y" },
                { row_id: "row-x", document_id: "doc-x" },
                { row_id: "row-mixed", document_id: "doc-y" },
                { row_id: "row-mixed", document_id: "doc-x" },
            ],
            tabular_cells: [
                { id: "cell-y", review_id: "review-y", row_id: "row-y", content: "visible" },
                { id: "cell-x", review_id: "review-y", row_id: "row-x", content: SECRET },
                { id: "cell-mixed", review_id: "review-y", row_id: "row-mixed", content: `${SECRET} (folder)` },
            ],
        };
    }

    const revoke = (tables: Record<string, Row[]>) => {
        tables.project_access_grants = [];
    };

    it("drops cells fed by a revoked cross-project document from the review and account exports", async () => {
        const tables = crossProjectTables();
        const { db } = makeDb(tables);

        // While X is shared, every cell travels: the filter is per source,
        // not a blanket drop of cross-project rows.
        expect(
            ids((await buildUserTabularReviewsExport(db, userId, email)).tabular_cells),
        ).toEqual(["cell-y", "cell-x", "cell-mixed"]);

        revoke(tables);

        const reviews = await buildUserTabularReviewsExport(db, userId, email);
        const account = await buildUserAccountExport(db, userId, email);
        expect(ids(reviews.tabular_reviews)).toEqual(["review-y"]);
        expect(ids(reviews.tabular_cells)).toEqual(["cell-y"]);
        expect(ids(account.tabular_cells)).toEqual(["cell-y"]);
        expect(JSON.stringify(reviews)).not.toContain(SECRET);
        expect(JSON.stringify(account)).not.toContain(SECRET);
    });

    it("fails closed when the source documents cannot be read", async () => {
        const { db } = makeDb(crossProjectTables(), {
            tabular_review_row_sources: { message: "unavailable" },
        });

        await expect(
            buildUserTabularReviewsExport(db, userId, email),
        ).rejects.toThrow();
    });

    describe("queued export.build job", () => {
        beforeEach(() => uploadFile.mockClear());

        const job = (type: string): DbJob => ({
            id: "job-1",
            kind: "export.build",
            payload: { userId, userEmail: email, type },
            status: "running",
            attempts: 1,
            max_attempts: 3,
            run_at: "",
            claimed_at: null,
            finished_at: null,
            last_error: null,
            dedupe_key: null,
            result: null,
            created_at: "",
        });

        it.each(["tabular-reviews", "account"])(
            "re-checks source access when the %s job runs, after a revocation while queued",
            async (type) => {
                const tables = crossProjectTables();
                const { db } = makeDb(tables);
                // Enqueued while X was shared; revoked before the worker ran.
                revoke(tables);

                const out = await handleExportBuild(db, job(type));

                expect(uploadFile).toHaveBeenCalledTimes(1);
                const [path, body] = uploadFile.mock.calls[0] as [string, ArrayBuffer];
                expect(path).toBe(out.storage_path);
                expect(out.filename).toMatch(new RegExp(`^litt-${type}-export-`));
                const artifact = JSON.parse(Buffer.from(body).toString("utf8"));
                expect(ids(artifact.tabular_cells)).toEqual(["cell-y"]);
                expect(Buffer.from(body).toString("utf8")).not.toContain(SECRET);
            },
        );
    });
});

/**
 * Review chat transcripts hold text derived from the review's source
 * documents. A Y member who cannot read X — never could, or lost access —
 * must not receive X's text through a transcript in any export, including the
 * queued job, while a reader who can still read X keeps the collaboration.
 */
describe("exports narrow review transcripts to readable source documents", () => {
    const SECRET = "SECRET FROM X";

    function transcriptTables(): Record<string, Row[]> {
        return {
            projects: [
                { id: "project-y", user_id: userId, org_id: null, name: "Y" },
                { id: "project-x", user_id: "colleague", org_id: null, name: "X" },
            ],
            project_access_grants: [
                { project_id: "project-x", email, role: "viewer" },
                { project_id: "project-y", email: "colleague@example.test", role: "editor" },
            ],
            documents: [
                { id: "doc-y", user_id: userId, project_id: "project-y", org_id: null },
                { id: "doc-x", user_id: "colleague", project_id: "project-x", org_id: null },
            ],
            tabular_reviews: [
                { id: "review-y", user_id: userId, project_id: "project-y", org_id: null },
            ],
            tabular_review_rows: [
                { id: "row-y", review_id: "review-y", document_id: "doc-y", sort_index: 0 },
                { id: "row-x", review_id: "review-y", document_id: "doc-x", sort_index: 1 },
            ],
            tabular_review_row_sources: [],
            tabular_cells: [
                { id: "cell-y", review_id: "review-y", row_id: "row-y", content: "visible" },
                { id: "cell-x", review_id: "review-y", row_id: "row-x", content: SECRET },
            ],
            tabular_review_chats: [
                { id: "thread-own", review_id: "review-y", user_id: userId, title: "Y and X" },
                { id: "thread-colleague", review_id: "review-y", user_id: "colleague", title: `${SECRET} title` },
            ],
            tabular_review_chat_messages: [
                { id: "m-y", chat_id: "thread-own", role: "user", content: "About Y", source_document_ids: ["doc-y"] },
                { id: "m-x", chat_id: "thread-own", role: "assistant", content: [{ type: "content", text: SECRET }], source_document_ids: ["doc-x", "doc-y"] },
                { id: "m-colleague", chat_id: "thread-colleague", role: "assistant", content: SECRET, source_document_ids: ["doc-x"] },
                { id: "m-legacy", chat_id: "thread-own", role: "assistant", content: "LEGACY", source_document_ids: null },
            ],
        };
    }

    const revoke = (tables: Record<string, Row[]>) => {
        tables.project_access_grants = tables.project_access_grants.filter(
            (grant) => grant.project_id !== "project-x",
        );
    };

    it("keeps authorized collaboration and drops X-derived messages and titles after revocation", async () => {
        const tables = transcriptTables();
        const { db } = makeDb(tables);

        const sharedReviews = await buildUserTabularReviewsExport(db, userId, email);
        expect(ids(sharedReviews.tabular_review_chats.messages)).toEqual([
            "m-y",
            "m-x",
            "m-colleague",
        ]);
        expect(
            ids((await buildUserChatsExport(db, userId, email)).tabular_review_chats.messages),
        ).toEqual(["m-y", "m-x"]);

        revoke(tables);

        const reviews = await buildUserTabularReviewsExport(db, userId, email);
        const chats = await buildUserChatsExport(db, userId, email);
        const account = await buildUserAccountExport(db, userId, email);
        expect(ids(reviews.tabular_cells)).toEqual(["cell-y"]);
        expect(ids(reviews.tabular_review_chats.messages)).toEqual(["m-y"]);
        expect(reviews.tabular_review_chats.chats).toEqual([
            expect.objectContaining({ id: "thread-own", title: null }),
            expect.objectContaining({ id: "thread-colleague", title: null }),
        ]);
        expect(ids(chats.tabular_review_chats.messages)).toEqual(["m-y"]);
        expect(ids(account.tabular_review_chats.messages)).toEqual(["m-y"]);
        for (const artifact of [reviews, chats, account]) {
            expect(JSON.stringify(artifact)).not.toContain(SECRET);
            expect(JSON.stringify(artifact)).not.toContain("LEGACY");
        }
    });

    // A transcript longer than one PostgREST page (max_rows = 1000): the only
    // X-derived message sits on the second page.
    const withLongChat = (tables: Record<string, Row[]>) => {
        tables.tabular_review_chats.push({
            id: "thread-long",
            review_id: "review-y",
            user_id: userId,
            title: `${SECRET} long`,
        });
        for (let i = 0; i < 1000; i++)
            tables.tabular_review_chat_messages.push({
                id: `m-long-${String(i).padStart(4, "0")}`,
                chat_id: "thread-long",
                role: "user",
                content: "About Y",
                source_document_ids: ["doc-y"],
            });
        tables.tabular_review_chat_messages.push({
            id: "m-long-x",
            chat_id: "thread-long",
            role: "assistant",
            content: SECRET,
            source_document_ids: ["doc-x", "doc-y"],
        });
        return tables;
    };
    const longIds = (messages: Row[]) =>
        ids(messages).filter((id) => String(id).startsWith("m-long"));
    const longTitle = (chats: Row[]) =>
        chats.find((chat) => chat.id === "thread-long")?.title;

    it("reads a transcript past one page and still withholds its X message and title after revocation", async () => {
        const tables = withLongChat(transcriptTables());
        const { db } = makeDb(tables);

        const shared = await buildUserChatsExport(db, userId, email);
        expect(longIds(shared.tabular_review_chats.messages)).toHaveLength(1001);
        expect(longIds(shared.tabular_review_chats.messages)).toContain("m-long-x");
        expect(longTitle(shared.tabular_review_chats.chats)).toBe(`${SECRET} long`);

        revoke(tables);

        for (const artifact of [
            await buildUserTabularReviewsExport(db, userId, email),
            await buildUserChatsExport(db, userId, email),
            await buildUserAccountExport(db, userId, email),
        ]) {
            const transcripts = artifact.tabular_review_chats;
            expect(longIds(transcripts.messages)).toHaveLength(1000);
            expect(longIds(transcripts.messages)).not.toContain("m-long-x");
            expect(longTitle(transcripts.chats)).toBeNull();
            expect(JSON.stringify(artifact)).not.toContain(SECRET);
        }
    });

    it("fails closed when PostgREST caps a page below the requested size", async () => {
        const { db } = makeDb(withLongChat(transcriptTables()), {}, 500);

        const result = await buildUserChatsExport(db, userId, email).catch(
            (error: unknown) => error,
        );
        expect(result).toBeInstanceOf(Error);
        expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    it("fails closed when document access cannot be resolved", async () => {
        const { db } = makeDb(transcriptTables(), {
            documents: { message: "unavailable" },
        });

        const result = await buildUserChatsExport(db, userId, email).catch(
            (error: unknown) => error,
        );
        expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    describe("queued export.build job", () => {
        beforeEach(() => uploadFile.mockClear());

        it.each(["chats", "tabular-reviews", "account"])(
            "re-checks transcript sources when the %s job runs after a revocation",
            async (type) => {
                const tables = withLongChat(transcriptTables());
                const { db } = makeDb(tables);
                revoke(tables);

                await handleExportBuild(db, {
                    id: "job-1",
                    kind: "export.build",
                    payload: { userId, userEmail: email, type },
                    status: "running",
                    attempts: 1,
                    max_attempts: 3,
                    run_at: "",
                    claimed_at: null,
                    finished_at: null,
                    last_error: null,
                    dedupe_key: null,
                    result: null,
                    created_at: "",
                });

                expect(uploadFile).toHaveBeenCalledTimes(1);
                const body = Buffer.from(
                    (uploadFile.mock.calls[0] as [string, ArrayBuffer])[1],
                ).toString("utf8");
                const transcripts = JSON.parse(body).tabular_review_chats;
                expect(
                    ids(transcripts.messages).filter((id) => !String(id).startsWith("m-long")),
                ).toEqual(["m-y"]);
                expect(longIds(transcripts.messages)).toHaveLength(1000);
                expect(longTitle(transcripts.chats)).toBeNull();
                expect(body).not.toContain(SECRET);
            },
        );
    });
});

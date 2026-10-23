import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// #463 (i) — the document picker must not out-vote the access verdict.
//
// GET /projects?view=directory-search used to answer with every project in
// every organization the caller belongs to. In LiTT membership is not a
// verdict: a `deny` override on a project, or a project linked to a `private`
// matter the caller has no active membership on, makes checkProjectAccess
// answer "no access". listAccessibleProjectIds is the single place that
// encodes the verdict set, so the picker must ask it instead of trusting the
// membership sweep. Otherwise a walled-off member reads the matter's name,
// cm_number and its document filenames out of the picker.
// ---------------------------------------------------------------------------

const { listAccessibleProjectIds, listUserOrgIds } = vi.hoisted(() => ({
    listAccessibleProjectIds: vi.fn(),
    listUserOrgIds: vi.fn(),
}));

type Row = Record<string, any>;

let tables: {
    own: Row[];
    granted: Row[];
    org: Row[];
    versions: Row[];
    documents: Row[];
    profiles: Row[];
};

function projectsBuilder() {
    let rows: Row[] = [];
    const b: any = {
        select: () => b,
        eq: (column: string) => {
            rows = column === "user_id" ? tables.own : [];
            return b;
        },
        in: (column: string) => {
            rows =
                column === "id"
                    ? tables.granted
                    : column === "org_id"
                      ? tables.org
                      : [];
            return b;
        },
        then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return b;
}

function versionsBuilder() {
    const b: any = {
        select: () => b,
        ilike: () => b,
        is: () => b,
        then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: tables.versions, error: null }).then(resolve),
    };
    return b;
}

function documentsBuilder() {
    let projectIds: string[] = [];
    let versionIds: string[] = [];
    const b: any = {
        select: () => b,
        in: (column: string, values: string[]) => {
            if (column === "project_id") projectIds = values;
            if (column === "current_version_id") versionIds = values;
            return b;
        },
        then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
                data: tables.documents.filter(
                    (doc) =>
                        projectIds.includes(doc.project_id) &&
                        versionIds.includes(doc.current_version_id),
                ),
                error: null,
            }).then(resolve),
    };
    return b;
}

function profilesBuilder() {
    const b: any = {
        select: () => b,
        in: () => b,
        then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: tables.profiles, error: null }).then(resolve),
    };
    return b;
}

function grantsBuilder() {
    const b: any = {
        select: () => b,
        eq: () => b,
        then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
                data: tables.granted.map((project) => ({
                    project_id: project.id,
                })),
                error: null,
            }).then(resolve),
    };
    return b;
}

function makeDb() {
    return {
        from: (table: string) => {
            if (table === "projects") return projectsBuilder();
            if (table === "project_access_grants") return grantsBuilder();
            if (table === "document_versions") return versionsBuilder();
            if (table === "documents") return documentsBuilder();
            if (table === "user_profiles") return profilesBuilder();
            throw new Error(`unexpected table in picker test: ${table}`);
        },
    };
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => makeDb()),
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "member-1";
        res.locals.userEmail = "Member@Firm.example";
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

// Keep the real helper implementations, but control the two the picker asks
// for: the verdict set and the membership sweep.
vi.mock("../../lib/access", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/access")>();
    return {
        ...actual,
        listAccessibleProjectIds: (...args: unknown[]) =>
            listAccessibleProjectIds(...args),
        listUserOrgIds: (...args: unknown[]) => listUserOrgIds(...args),
    };
});

vi.mock("../../lib/documentVersions", () => ({
    attachLatestVersionNumbers: vi.fn(async () => {}),
    attachActiveVersionPaths: vi.fn(async () => {}),
    contentSha256: vi.fn(() => "0".repeat(64)),
}));

import { projectsRouter } from "../../routes/projects";

const app = express();
app.use(express.json());
app.use("/projects", projectsRouter);

const AUTH = ["Authorization", "Bearer test"] as const;

const OWN_PROJECT = {
    id: "p-own",
    name: "Own matter",
    cm_number: "CM-1",
    user_id: "member-1",
    org_id: null,
    updated_at: "2026-10-01T00:00:00.000Z",
};
const REACHABLE = {
    id: "p-ok",
    name: "Shared merger",
    cm_number: "CM-2",
    user_id: "someone-else",
    org_id: "org-1",
    updated_at: "2026-10-02T00:00:00.000Z",
};
const DENIED = {
    id: "p-secret",
    name: "Secret merger",
    cm_number: "CM-777",
    user_id: "someone-else",
    org_id: "org-1",
    updated_at: "2026-10-03T00:00:00.000Z",
};
const PRIVATE_MATTER = {
    id: "p-private",
    name: "Private merger",
    cm_number: "CM-888",
    user_id: "someone-else",
    org_id: "org-1",
    updated_at: "2026-10-04T00:00:00.000Z",
};

const VERSIONS = [
    { id: "v-own", filename: "merger-notes.docx" },
    { id: "v-ok", filename: "merger-draft.docx" },
    { id: "v-denied", filename: "secret-merger-agreement.docx" },
    { id: "v-private", filename: "private-merger-terms.docx" },
];

const DOCUMENTS = [
    { id: "d-own", project_id: "p-own", current_version_id: "v-own" },
    { id: "d-ok", project_id: "p-ok", current_version_id: "v-ok" },
    { id: "d-denied", project_id: "p-secret", current_version_id: "v-denied" },
    {
        id: "d-private",
        project_id: "p-private",
        current_version_id: "v-private",
    },
];

function search() {
    return request(app)
        .get("/projects?view=directory-search&search=merger")
        .set(...AUTH);
}

beforeEach(() => {
    vi.clearAllMocks();
    tables = {
        own: [],
        granted: [],
        org: [REACHABLE, DENIED, PRIVATE_MATTER],
        versions: VERSIONS,
        documents: DOCUMENTS,
        profiles: [],
    };
    listUserOrgIds.mockResolvedValue(["org-1"]);
    listAccessibleProjectIds.mockResolvedValue([]);
});

describe("GET /projects?view=directory-search — access verdict", () => {
    it("drops an organization matter the caller is denied", async () => {
        // The caller is an org member, and the org branch of the picker
        // therefore loads the denied matter. The verdict set says no.
        listAccessibleProjectIds.mockResolvedValue(["p-ok"]);

        const res = await search();

        expect(res.status).toBe(200);
        expect(res.body.map((project: Row) => project.id)).toEqual(["p-ok"]);
        expect(JSON.stringify(res.body)).not.toContain("secret-merger");
        expect(JSON.stringify(res.body)).not.toContain("CM-777");
        expect(JSON.stringify(res.body)).not.toContain("Secret merger");
    });

    it("drops a private matter the caller is not an active member of", async () => {
        // Same org membership, but the matter's membership list does not
        // include the caller: listAccessibleProjectIds omits it.
        listAccessibleProjectIds.mockResolvedValue(["p-ok"]);

        const res = await search();

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain("private-merger-terms");
        expect(JSON.stringify(res.body)).not.toContain("CM-888");
    });

    it("keeps listing a project the caller can reach", async () => {
        // Guard against the cheap "return nothing" fix: an admitted project
        // still comes back with its matching documents. The org branch holds
        // only that project, so this case is green before and after.
        tables.org = [REACHABLE];
        listAccessibleProjectIds.mockResolvedValue(["p-ok"]);

        const res = await search();

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].id).toBe("p-ok");
        expect(
            (res.body[0].documents as Row[]).map((doc) => doc.id),
        ).toEqual(["d-ok"]);
    });

    it("keeps the caller's own project in the picker", async () => {
        tables.own = [OWN_PROJECT];
        tables.org = [];
        listAccessibleProjectIds.mockResolvedValue(["p-own"]);

        const res = await search();

        expect(res.status).toBe(200);
        expect(res.body.map((project: Row) => project.id)).toEqual(["p-own"]);
        expect(res.body[0].is_owner).toBe(true);
    });

    it("asks the verdict helper with the caller's identity", async () => {
        await search();

        expect(listAccessibleProjectIds).toHaveBeenCalledWith(
            "member-1",
            "Member@Firm.example",
            expect.anything(),
        );
    });
});

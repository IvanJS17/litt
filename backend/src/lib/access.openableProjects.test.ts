import { describe, expect, it } from "vitest";
import { checkProjectAccess, loadOpenableProjects } from "./access";
import type { Db } from "./supabase";
import { ownerlessRpcResult } from "../__tests__/helpers/ownerlessRpc";
import { tableDb } from "../__tests__/helpers/tableDb";

// loadOpenableProjects is the set form of checkProjectAccess: the same verdict
// for a list of projects, from a fixed number of reads. The first suite asks
// both for every (user, project) pair of one scenario and requires the same
// answer; the second pins the number of reads.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const OTHER_ORG = id(2);
const CREATOR = id(10), OWNER = id(11), ADMIN = id(12), MEMBER = id(13), SHARED = id(14), WALLED = id(15);
const LEFT = id(16), OUTSIDER = id(17), TEAM = id(18), PERSONAL_OWNER = id(19), GRANTEE = id(20);
const USERS = [CREATOR, OWNER, ADMIN, MEMBER, SHARED, WALLED, LEFT, OUTSIDER, TEAM, PERSONAL_OWNER, GRANTEE];
const email = (u: string) => (u === GRANTEE ? "grantee@example.test" : `${u}@example.test`);

type Row = Record<string, unknown>;
const project = (n: number, extra: Row = {}): Row => ({
    id: id(100 + n), user_id: CREATOR, org_id: ORG, visibility: "private", archived_at: null, ...extra,
});

function world() {
    const tables: Record<string, Row[]> = {
        org_members: [
            { org_id: ORG, user_id: CREATOR, role: "member" },
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: ADMIN, role: "admin" },
            { org_id: ORG, user_id: MEMBER, role: "member" },
            { org_id: ORG, user_id: SHARED, role: "member" },
            { org_id: ORG, user_id: WALLED, role: "member" },
            { org_id: ORG, user_id: TEAM, role: "member" },
            { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
        ],
        projects: [
            project(1),                                              // private, creator's
            project(2, { visibility: "organization" }),              // public to the org
            project(3, { archived_at: "2026-01-01T00:00:00Z" }),     // archived
            project(4, { user_id: LEFT }),                           // creator left: ownerless
            project(5),                                              // shared with SHARED
            project(6, { visibility: "organization" }),              // public, but WALLED is denied
            project(7, { org_id: OTHER_ORG, user_id: OUTSIDER }),    // another organization
            project(8, { org_id: null, user_id: PERSONAL_OWNER }),   // personal
            project(9, { org_id: null, user_id: PERSONAL_OWNER }),   // personal, granted by email
            project(10, { visibility: "organization" }),             // a private matter's project
        ],
        project_org_access_overrides: [
            { project_id: id(105), org_id: ORG, user_id: SHARED, role: "editor" },
            { project_id: id(106), org_id: ORG, user_id: WALLED, role: "deny" },
            // an override filed under another organization must not count
            { project_id: id(101), org_id: OTHER_ORG, user_id: MEMBER, role: "editor" },
        ],
        project_access_grants: [{ project_id: id(109), email: "grantee@example.test", role: "viewer" }],
        matters: [{ id: id(900), project_id: id(110), workspace_id: id(901), visibility: "private" }],
        workspaces: [{ id: id(901), organization_id: ORG }],
        matter_memberships: [{ matter_id: id(900), user_id: TEAM, status: "active" }],
    };
    const { db, calls } = tableDb(tables, { maxInList: 100 });
    const rpc = async (name: string, args?: Record<string, unknown>) =>
        ownerlessRpcResult(tables, name, args) ?? { data: null, error: { message: `unexpected rpc ${name}` } };
    return { db: { from: db.from, rpc } as unknown as Db, calls, tables };
}

describe("loadOpenableProjects", () => {
    it("answers exactly what checkProjectAccess answers, for every user and project", async () => {
        const { db, tables } = world();
        const ids = [...tables.projects.map((p) => p.id as string), id(999) /* missing */];
        let admitted = 0;
        for (const user of USERS) {
            const set = await loadOpenableProjects(db, user, email(user), ids);
            for (const projectId of ids) {
                const single = await checkProjectAccess(projectId, user, email(user), db);
                expect(set.has(projectId), `${user} on ${projectId}`).toBe(single.ok);
                if (single.ok) {
                    admitted += 1;
                    expect(set.get(projectId)?.orgId).toBe(single.project.org_id);
                }
            }
        }
        // The scenario exercises both verdicts, not only denials.
        expect(admitted).toBeGreaterThan(15);
        expect(admitted).toBeLessThan(USERS.length * ids.length - 15);
    });

    it("reads a fixed number of times however many projects it is asked about", async () => {
        const small = world();
        await loadOpenableProjects(small.db, OWNER, email(OWNER), [id(101), id(102)]);
        const many = world();
        for (let n = 0; n < 150; n += 1) many.tables.projects.push(project(1000 + n));
        const ids = many.tables.projects.map((p) => p.id as string);
        await loadOpenableProjects(many.db, OWNER, email(OWNER), ids);
        // Table reads for two projects: projects, memberships, overrides. 160
        // projects span two id chunks, so the project and override reads
        // repeat, and the personal ones add the one grants read.
        expect(small.calls.map((call) => call.table)).toEqual([
            "projects", "org_members", "project_org_access_overrides",
        ]);
        expect(many.calls.length).toBe(small.calls.length + 3);
        expect(many.calls.every((call) => call.inSizes.every((size) => size <= 100))).toBe(true);
    });

    it("throws on a failed read instead of admitting nobody silently", async () => {
        const { db } = world();
        const failing = {
            ...db,
            from: (table: string) =>
                table === "project_org_access_overrides"
                    ? { select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }) }
                    : (db as unknown as { from: (t: string) => unknown }).from(table),
        } as unknown as Db;
        await expect(loadOpenableProjects(failing, MEMBER, email(MEMBER), [id(101)])).rejects.toThrow();
    });

    it("asks nothing for an empty list", async () => {
        const { db, calls } = world();
        expect((await loadOpenableProjects(db, MEMBER, null, [])).size).toBe(0);
        expect(calls).toEqual([]);
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Donna's per-project switch (docs/request-triage.md): born on unless the box was
// unchecked at creation, and changed only by whoever changes project settings
// (the project owner or a firm admin). The column's default (migration
// 20261119_80) also turns it on for the projects that already existed; that part
// is in requestTriage.postgres.test.ts.
vi.mock("../../../lib/storage", () => ({}));
const h = vi.hoisted(() => ({ role: "owner" as string }));
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    getOrgRole: vi.fn(async () => "owner"),
    checkProjectAccess: vi.fn(async (projectId: string) => ({
        ok: true,
        isCreator: false,
        orgRole: "admin",
        projectRole: h.role,
        project: { id: projectId, org_id: "org-1" },
    })),
}));
vi.mock("../../../lib/personalOrgs", () => ({ isPersonalOrg: vi.fn(async () => false) }));
vi.mock("../../../lib/managedAccounts", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/managedAccounts")>()),
    assertPersonalWorkspaceAllowed: vi.fn(),
}));

import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import { createProject, updateProject } from "../projects.crud";

const PROJECT = "00000000-0000-4000-8000-000000000120";
let tables: Record<string, Row[]>;
let db: ReturnType<typeof memoryDb>["db"];

beforeEach(() => {
    h.role = "owner";
    const world = memoryDb(
        { projects: [{ id: PROJECT, name: "P", org_id: "org-1", donna_enabled: true }], user_profiles: [{ user_id: "u1", project_memory_default: true }] },
        {
            create_project_with_memory: (args, all) => {
                const row = { id: "00000000-0000-4000-8000-000000000999", name: args.p_name, user_id: args.p_user_id, org_id: args.p_org_id, donna_enabled: true };
                all.projects.push(row);
                return [row];
            },
        },
    );
    tables = world.tables;
    db = world.db;
});

describe("creating a project", () => {
    it("is born with Donna on when the box is left as it comes", async () => {
        const created = await createProject(db, { userId: "u1", name: "Iguala", org_id: "org-1" });
        expect(created).toMatchObject({ ok: true, project: { donna_enabled: true } });
        expect(tables.projects.at(-1)).toMatchObject({ name: "Iguala", donna_enabled: true });
    });

    it("is born with Donna off when the box was unchecked", async () => {
        const created = await createProject(db, { userId: "u1", name: "Iguala", org_id: "org-1", donna_enabled: false });
        expect(created).toMatchObject({ ok: true, project: { donna_enabled: false } });
        expect(tables.projects.at(-1)).toMatchObject({ name: "Iguala", donna_enabled: false });
    });

    it("fails closed when the opt-out cannot be saved, and refuses a non-boolean", async () => {
        const world = memoryDb({}, { create_project_with_memory: () => [{ id: PROJECT, name: "x" }] });
        world.failNext("projects", "update", { message: "down" });
        const failed = await createProject(world.db, { userId: "u1", name: "Iguala", org_id: "org-1", donna_enabled: false });
        expect(failed).toMatchObject({ ok: false, kind: "db_error", created: { id: PROJECT } });
        const bad = await createProject(db, { userId: "u1", name: "Iguala", donna_enabled: "no" });
        expect(bad).toMatchObject({ ok: false, kind: "validation", detail: "donna_enabled must be a boolean" });
    });
});

describe("changing the switch", () => {
    it("lets the project owner (or a firm admin, who holds the same gate) turn it off and on", async () => {
        const off = await updateProject(db, { projectId: PROJECT, userId: "u1", body: { donna_enabled: false } });
        expect(off).toMatchObject({ ok: true, body: { donna_enabled: false } });
        expect(tables.projects[0].donna_enabled).toBe(false);
        const on = await updateProject(db, { projectId: PROJECT, userId: "u1", body: { donna_enabled: true } });
        expect(on).toMatchObject({ ok: true, body: { donna_enabled: true } });
    });

    it.each(["editor", "member", "viewer"])("refuses a %s, who sees the switch read-only", async (role) => {
        h.role = role;
        const refused = await updateProject(db, { projectId: PROJECT, userId: "u2", body: { donna_enabled: false } });
        expect(refused).toMatchObject({ ok: false, kind: "forbidden" });
        expect(tables.projects[0].donna_enabled).toBe(true);
    });

    it("refuses a value that is not a boolean", async () => {
        const bad = await updateProject(db, { projectId: PROJECT, userId: "u1", body: { donna_enabled: "off" } });
        expect(bad).toMatchObject({ ok: false, kind: "validation" });
        expect(tables.projects[0].donna_enabled).toBe(true);
    });
});

describe("the switch leaves an audit record", () => {
    const events = () => tables.audit_events ?? [];

    it("writes one event with who, firm, project, old and new value when the stored value changes", async () => {
        await updateProject(db, { projectId: PROJECT, userId: "u1", userEmail: "u1@example.test", body: { donna_enabled: false } });
        expect(events()).toHaveLength(1);
        expect(events()[0]).toMatchObject({
            action: "project.donna_switch.changed",
            user_id: "u1",
            user_email: "u1@example.test",
            org_id: "org-1",
            project_id: PROJECT,
            detail: { project_id: PROJECT, old_value: true, new_value: false },
        });
        await updateProject(db, { projectId: PROJECT, userId: "u1", body: { donna_enabled: true } });
        expect(events()).toHaveLength(2);
        expect(events()[1]).toMatchObject({ detail: { old_value: false, new_value: true } });
    });

    it("writes none when the value is sent but is the stored one, or is not sent", async () => {
        await updateProject(db, { projectId: PROJECT, userId: "u1", body: { donna_enabled: true } });
        await updateProject(db, { projectId: PROJECT, userId: "u1", body: { name: "Otro nombre" } });
        expect(events()).toHaveLength(0);
    });

    it("writes none when the change is refused", async () => {
        h.role = "viewer";
        await updateProject(db, { projectId: PROJECT, userId: "u2", body: { donna_enabled: false } });
        expect(events()).toHaveLength(0);
    });

    it("writes one when a project is created with Donna off, and none when it is created as it comes", async () => {
        await createProject(db, { userId: "u1", name: "Iguala", org_id: "org-1" });
        expect(events()).toHaveLength(0);
        const created = await createProject(db, { userId: "u1", name: "Iguala", org_id: "org-1", donna_enabled: false });
        expect(created).toMatchObject({ ok: true });
        expect(events()).toHaveLength(1);
        expect(events()[0]).toMatchObject({
            action: "project.donna_switch.changed",
            user_id: "u1",
            org_id: "org-1",
            detail: { old_value: true, new_value: false },
        });
    });

    it("does not fail the change when the event cannot be written (as the firm's other audited settings), and the change stays", async () => {
        const world = memoryDb({ projects: [{ id: PROJECT, name: "P", org_id: "org-1", donna_enabled: true }] });
        world.failNext("audit_events", "insert", { message: "down" });
        const result = await updateProject(world.db, { projectId: PROJECT, userId: "u1", body: { donna_enabled: false } });
        expect(result).toMatchObject({ ok: true, body: { donna_enabled: false } });
        expect(world.tables.projects[0].donna_enabled).toBe(false);
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    // The project gate has its own suites; here a project is readable unless named.
    checkProjectAccess: vi.fn(async (projectId: string) => ({ ok: projectId !== "project-closed" })),
}));

import { buildUserAccountExport } from "../buildJsonExport";
import { loadUserMatterRequests } from "../matterRequestsExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// S0 decision: the account export of a firm's workspace carries the requests
// that name the holder (creator or assignee) in the matters they can still open,
// and the events they recorded. Other people's requests, matters the holder
// left, and other firms' matters stay out. Personal's export carries none.
const user = "holder";
const request = (id: string, matter: string, fields: Row = {}): Row => ({
    id,
    matter_id: matter,
    type_id: "type-1",
    title: `Title ${id}`,
    complexity: "standard",
    status: "received",
    assignee_user_id: null,
    assignee_level: null,
    received_on: "2026-11-02",
    closed_on: null,
    version: 1,
    created_by: "someone",
    created_at: `2026-11-0${id.length}T00:00:00Z`,
    updated_at: "2026-11-02T00:00:00Z",
    ...fields,
});

function tables(): Record<string, Row[]> {
    return {
        workspaces: [
            { id: "ws-current", organization_id: "org-current" },
            { id: "ws-other", organization_id: "org-other" },
        ],
        matters: [
            { id: "m-open", project_id: "project-open", workspace_id: "ws-current" },
            { id: "m-left", project_id: "project-open", workspace_id: "ws-current" },
            { id: "m-closed", project_id: "project-closed", workspace_id: "ws-current" },
            { id: "m-other-firm", project_id: "project-open", workspace_id: "ws-other" },
        ],
        matter_memberships: [
            { matter_id: "m-open", user_id: user, status: "active" },
            { matter_id: "m-left", user_id: user, status: "revoked" },
            { matter_id: "m-closed", user_id: user, status: "active" },
            { matter_id: "m-other-firm", user_id: user, status: "active" },
        ],
        matter_requests: [
            request("r1", "m-open", { created_by: user }),
            request("r22", "m-open", { assignee_user_id: user, assignee_level: "junior" }),
            request("r333", "m-open", { created_by: "someone", assignee_user_id: "other" }),
            request("r4444", "m-left", { created_by: user }),
            request("r55555", "m-closed", { created_by: user }),
            request("r666666", "m-other-firm", { created_by: user }),
        ],
        matter_request_events: [
            { id: "e1", request_id: "r1", matter_id: "m-open", actor_user_id: user, action: "created", detail: {}, created_at: "2026-11-02T00:00:00Z" },
            { id: "e2", request_id: "r1", matter_id: "m-open", actor_user_id: "someone", action: "edited", detail: {}, created_at: "2026-11-03T00:00:00Z" },
            { id: "e3", request_id: "r4444", matter_id: "m-left", actor_user_id: user, action: "created", detail: {}, created_at: "2026-11-02T00:00:00Z" },
        ],
    };
}

describe("account export: requests that name the holder", () => {
    let db: ReturnType<typeof makeExportDb>["db"];
    beforeEach(() => {
        db = makeExportDb(tables()).db;
    });

    it("carries the holder's own requests in matters they can open, and their own events", async () => {
        const exported = await loadUserMatterRequests(db, user, "holder@example.test", "org-current");
        expect(exported.requests.map((row) => row.id)).toEqual(["r1", "r22"]);
        expect(exported.events.map((row) => row.id)).toEqual(["e1"]);
        expect(exported.requests[0]).toMatchObject({ title: "Title r1", status: "received" });
    });

    it("carries nothing in Personal's export or for a person the requests never name", async () => {
        expect(await loadUserMatterRequests(db, user, null, null)).toEqual({ requests: [], events: [] });
        expect(await loadUserMatterRequests(db, "nobody", null, "org-current")).toEqual({ requests: [], events: [] });
    });

    it("is part of the organization's account JSON, and of no Personal one", async () => {
        const firm = await buildUserAccountExport(db, user, "holder@example.test", "org-current");
        expect((firm.matter_requests as Row[]).map((row) => row.id)).toEqual(["r1", "r22"]);
        expect((firm.matter_request_events as Row[]).map((row) => row.id)).toEqual(["e1"]);
        const personal = await buildUserAccountExport(db, user, "holder@example.test", null);
        expect(personal.matter_requests).toEqual([]);
        expect(personal.matter_request_events).toEqual([]);
    });
});

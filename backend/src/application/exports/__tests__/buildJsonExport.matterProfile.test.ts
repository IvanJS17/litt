import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    // The project gate has its own suites; here a project is readable unless named.
    checkProjectAccess: vi.fn(async (projectId: string) => ({ ok: projectId !== "project-closed" })),
}));

import { buildUserAccountExport } from "../buildJsonExport";
import { loadUserProfileFacts } from "../matterProfileExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// The account export of a firm's workspace carries the profile facts the holder
// captured and the events they recorded, in the matters they can still open.
// Facts of other people, matters the holder left and other firms' matters stay
// out. Personal's export carries none.
const user = "holder";
const fact = (id: string, matter: string, fields: Row = {}): Row => ({
    id,
    matter_id: matter,
    kind: "contract",
    label: `Fact ${id}`,
    data: {},
    document_id: "d1",
    version_id: "v1",
    start_char: 0,
    end_char: 5,
    quote: "hello",
    text_sha256: "a".repeat(64),
    created_by: "someone",
    created_at: `2026-11-0${id.length}T00:00:00Z`,
    ...fields,
});
const event = (id: string, factId: string, matter: string, actor: string): Row => ({
    id,
    fact_id: factId,
    matter_id: matter,
    actor_user_id: actor,
    action: "created",
    text_sha256: null,
    reason: null,
    created_at: "2026-11-02T00:00:00Z",
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
        matter_profile_facts: [
            fact("f1", "m-open", { created_by: user }),
            fact("f22", "m-open", { created_by: "someone" }),
            fact("f333", "m-left", { created_by: user }),
            fact("f4444", "m-closed", { created_by: user }),
            fact("f55555", "m-other-firm", { created_by: user }),
        ],
        matter_profile_fact_events: [
            event("e1", "f1", "m-open", user),
            event("e2", "f22", "m-open", user),
            event("e3", "f22", "m-open", "someone"),
            event("e4", "f333", "m-left", user),
        ],
    };
}

describe("account export: profile facts", () => {
    let db: ReturnType<typeof makeExportDb>["db"];
    beforeEach(() => {
        db = makeExportDb(tables()).db;
    });

    it("carries the holder's facts and own events in matters they can open", async () => {
        const exported = await loadUserProfileFacts(db, user, "holder@example.test", "org-current");
        expect(exported.facts.map((row) => row.id)).toEqual(["f1"]);
        // The holder's decision on somebody else's fact is the holder's own event.
        expect(exported.events.map((row) => row.id)).toEqual(["e1", "e2"]);
        expect(exported.facts[0]).toMatchObject({ label: "Fact f1", quote: "hello" });
    });

    it("carries nothing in Personal's export or for a person the facts never name", async () => {
        expect(await loadUserProfileFacts(db, user, null, null)).toEqual({ facts: [], events: [] });
        expect(await loadUserProfileFacts(db, "nobody", null, "org-current")).toEqual({ facts: [], events: [] });
    });

    it("is part of the organization's account JSON, and of no Personal one", async () => {
        const firm = await buildUserAccountExport(db, user, "holder@example.test", "org-current");
        expect((firm.matter_profile_facts as Row[]).map((row) => row.id)).toEqual(["f1"]);
        expect((firm.matter_profile_fact_events as Row[]).map((row) => row.id)).toEqual(["e1", "e2"]);
        const personal = await buildUserAccountExport(db, user, "holder@example.test", null);
        expect(personal.matter_profile_facts).toEqual([]);
        expect(personal.matter_profile_fact_events).toEqual([]);
    });
});

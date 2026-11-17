import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    // The project gate has its own suites; here a project is readable unless named.
    checkProjectAccess: vi.fn(async (projectId: string) => ({ ok: projectId !== "project-closed" })),
}));

import { buildUserAccountExport } from "../buildJsonExport";
import { loadUserObligationEvents, loadUserProfileFacts, loadUserRadarEvents, loadUserReportSentEvents } from "../matterProfileExport";
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
        matter_radar_item_events: [
            { id: "r1", fact_id: "f1", matter_id: "m-open", item_type: "expiry", action: "ack", due_on: "2026-12-31", reason: null, actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
            { id: "r2", fact_id: "f22", matter_id: "m-open", item_type: "notice", action: "dismiss", due_on: null, reason: "x", actor_user_id: "someone", created_at: "2026-11-03T00:00:00Z" },
            { id: "r3", fact_id: "f333", matter_id: "m-left", item_type: "expiry", action: "done", due_on: "2026-12-31", reason: null, actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
            { id: "r4", fact_id: "f4444", matter_id: "m-closed", item_type: "expiry", action: "done", due_on: "2026-12-31", reason: null, actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
        ],
        matter_obligation_rule_events: [
            { id: "o1", matter_id: "m-open", rule_code: "contract.notice", rule_version: 1, action: "activate", actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
            { id: "o2", matter_id: "m-open", rule_code: "contract.notice", rule_version: 1, action: "deactivate", actor_user_id: "someone", created_at: "2026-11-04T00:00:00Z" },
            { id: "o3", matter_id: "m-left", rule_code: "contract.notice", rule_version: 1, action: "activate", actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
        ],
        matter_obligation_item_events: [
            { id: "i1", matter_id: "m-open", item_key: "contract.notice@1:matter", action: "ack", due_on: null, reason: null, actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
            { id: "i2", matter_id: "m-closed", item_key: "contract.notice@1:matter", action: "done", due_on: null, reason: null, actor_user_id: user, created_at: "2026-11-03T00:00:00Z" },
        ],
        matter_report_sent_events: [
            { id: "s1", matter_id: "m-open", period_start: "2026-08-19", period_end: "2026-11-16", period_days: 90, note: null, actor_user_id: user, created_at: "2026-11-17T00:00:00Z" },
            { id: "s2", matter_id: "m-open", period_start: "2026-08-19", period_end: "2026-11-16", period_days: 90, note: null, actor_user_id: "someone", created_at: "2026-11-17T00:00:00Z" },
            { id: "s3", matter_id: "m-left", period_start: "2026-08-19", period_end: "2026-11-16", period_days: 90, note: "x", actor_user_id: user, created_at: "2026-11-17T00:00:00Z" },
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

    it("carries the radar actions the holder recorded, in matters they can still open", async () => {
        expect((await loadUserRadarEvents(db, user, "holder@example.test", "org-current")).map((row) => row.id)).toEqual(["r1"]);
        expect(await loadUserRadarEvents(db, user, null, null)).toEqual([]);
        expect(await loadUserRadarEvents(db, "nobody", null, "org-current")).toEqual([]);
        const firm = await buildUserAccountExport(db, user, "holder@example.test", "org-current");
        expect((firm.matter_radar_item_events as Row[]).map((row) => row.id)).toEqual(["r1"]);
        const personal = await buildUserAccountExport(db, user, "holder@example.test", null);
        expect(personal.matter_radar_item_events).toEqual([]);
    });

    it("carries the obligation rule decisions and item actions the holder recorded, in matters they can still open", async () => {
        const mine = await loadUserObligationEvents(db, user, "holder@example.test", "org-current");
        expect(mine.rules.map((row) => row.id)).toEqual(["o1"]);
        expect(mine.items.map((row) => row.id)).toEqual(["i1"]);
        expect(await loadUserObligationEvents(db, user, null, null)).toEqual({ rules: [], items: [] });
        expect(await loadUserObligationEvents(db, "nobody", null, "org-current")).toEqual({ rules: [], items: [] });
        const firm = await buildUserAccountExport(db, user, "holder@example.test", "org-current");
        expect((firm.matter_obligation_rule_events as Row[]).map((row) => row.id)).toEqual(["o1"]);
        expect((firm.matter_obligation_item_events as Row[]).map((row) => row.id)).toEqual(["i1"]);
        const personal = await buildUserAccountExport(db, user, "holder@example.test", null);
        expect(personal.matter_obligation_rule_events).toEqual([]);
        expect(personal.matter_obligation_item_events).toEqual([]);
    });

    it("carries the sent-report records the holder made, in matters they can still open", async () => {
        expect((await loadUserReportSentEvents(db, user, "holder@example.test", "org-current")).map((row) => row.id)).toEqual(["s1"]);
        expect(await loadUserReportSentEvents(db, user, null, null)).toEqual([]);
        expect(await loadUserReportSentEvents(db, "nobody", null, "org-current")).toEqual([]);
        const firm = await buildUserAccountExport(db, user, "holder@example.test", "org-current");
        expect((firm.matter_report_sent_events as Row[]).map((row) => row.id)).toEqual(["s1"]);
        const personal = await buildUserAccountExport(db, user, "holder@example.test", null);
        expect(personal.matter_report_sent_events).toEqual([]);
    });
});

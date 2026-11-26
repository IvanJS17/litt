// The playbooks a firm's request types show are the ones the reader may open:
// a member put on a playbook's deny list sees neither its link nor its name,
// and cannot link it either.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/training", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTrainingStage: vi.fn(async () => null),
}));
vi.mock("../requests.triage.usage", () => ({
  countMonthRuns: vi.fn(async () => ({ ok: true, data: 0 })),
}));
import type { Db } from "../../../lib/supabase";
import { database, ORG, type Row } from "../../playbooks/__tests__/playbookTestDb";
import { linkTypePlaybook, listTypePlaybooks } from "../requests.playbooks";
import { buildCard } from "../requests.triage.read";
import { playbooksForType } from "../requests.triage.run";

const TYPE = "33333333-3333-4333-8333-333333333333";
const OPEN = "44444444-4444-4444-8444-444444444444";
const WALLED = "55555555-5555-4555-8555-555555555555";

const playbook = (id: string, name: string): Row => ({
  id,
  name,
  user_id: "owner",
  org_id: ORG,
  visibility: "organization",
  status: "ready",
  content_json: {},
});

function world(role: "member" | "admin") {
  const { db, tables } = database(
    [playbook(OPEN, "Open guide"), playbook(WALLED, "Walled guide")],
    [
      { user_id: "reader", org_id: ORG, role },
      { user_id: "owner", org_id: ORG, role: "member" },
    ],
    [],
    [{ playbook_id: WALLED, user_id: "reader", org_id: ORG, role: "deny" }],
  );
  tables.matter_request_types = [{ id: TYPE, organization_id: ORG, archived_at: null }];
  tables.request_type_playbooks = [OPEN, WALLED].map((playbook_id, index) => ({
    id: `link-${index}`,
    org_id: ORG,
    type_id: TYPE,
    playbook_id,
    linked_at: "2026-11-01",
    unlinked_at: null,
  }));
  seeded = { db: db as Db, tables };
  return db as Db;
}
let seeded: { db: Db; tables: Record<string, Row[]> };
const seed = () => seeded;

const actor = { userId: "reader", orgId: ORG };

describe("playbooks shown on request types", () => {
  it("leaves out a playbook the reader is denied, in links and in options", async () => {
    const listed = await listTypePlaybooks(world("member"), { ...actor, typeId: TYPE });
    expect(listed.ok && listed.data.links.map((link) => link.name)).toEqual(["Open guide"]);
    expect(listed.ok && listed.data.available.map((option) => option.name)).toEqual(["Open guide"]);
  });

  it("does not let a denied administrator link it, and answers as for an unknown playbook", async () => {
    const linked = await linkTypePlaybook(world("admin"), { ...actor, typeId: TYPE, body: { playbook_id: WALLED } });
    expect(linked).toMatchObject({ ok: false, kind: "not_found" });
  });
});

describe("playbooks shown on the triage card and used by the triage run", () => {
  it("offers the run only the playbooks of the type that the acting person may open", async () => {
    const found = await playbooksForType(world("member"), ORG, TYPE, "reader");
    expect(found.ok && found.data.map((row) => row.name)).toEqual(["Open guide"]);
  });

  it("offers the run nothing for a person who is not a member of the firm", async () => {
    const found = await playbooksForType(world("member"), ORG, TYPE, "stranger");
    expect(found.ok && found.data).toEqual([]);
  });

  it("leaves a denied playbook off the card, in its list and in the name of an item", async () => {
    world("member");
    const { db: seededDb, tables: t } = seed();
    t.projects = [{ id: "project-1", donna_enabled: true }];
    t.matter_request_triage_reservations = [];
    t.matter_request_triage_runs = [{ id: "run-1", request_id: "request-1", trigger: "auto", created_at: "2026-11-02", classify_status: "ok", generative_status: "ok", docs_total: 0, docs_read: 0, docs_partial: 0, unread_version_ids: [], quotes_rejected: 0 }];
    t.matter_request_triage_items = [OPEN, WALLED].map((playbook_id, position) => ({ id: `item-${position}`, run_id: "run-1", kind: "strategy", position, value_type_id: null, value_enum: null, value_user_id: null, confidence: null, low_confidence: false, forced_by_alarm: false, draft_text: "t", draft_purpose: "p", playbook_id, version_id: null }));
    t.matter_request_triage_decisions = [];
    const card = await buildCard(seededDb, {
      userId: "reader",
      orgId: ORG,
      projectId: "project-1",
      matterId: "matter-1",
      request: { id: "request-1", type_id: TYPE, created_at: "2026-11-02" },
      canWrite: true,
    });
    expect(card.ok && card.data.playbooks.map((row) => row.name)).toEqual(["Open guide"]);
    expect(card.ok && card.data.items.map((item) => item.playbook?.name ?? null)).toEqual(["Open guide", null]);
  });
});

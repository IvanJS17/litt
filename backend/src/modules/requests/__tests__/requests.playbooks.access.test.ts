// The playbooks a firm's request types show are the ones the reader may open:
// a member put on a playbook's deny list sees neither its link nor its name,
// and cannot link it either.
import { describe, expect, it } from "vitest";
import type { Db } from "../../../lib/supabase";
import { database, ORG, type Row } from "../../playbooks/__tests__/playbookTestDb";
import { linkTypePlaybook, listTypePlaybooks } from "../requests.playbooks";

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
  return db as Db;
}

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

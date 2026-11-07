// LiTT playbooks with a starting point, layer 1 (T1): a draft is refused by
// reviews, its provenance cannot be forged through autosave and is not sent
// to the review model, and an editor marks it ready or a model.
import { beforeEach, describe, expect, it, vi } from "vitest";
const { completeText, getUserApiKeys, recordAudit } = vi.hoisted(() => ({
  completeText: vi.fn(),
  getUserApiKeys: vi.fn(),
  recordAudit: vi.fn(),
}));
vi.mock("../../../lib/llm", async (original) => ({
  ...(await original<typeof import("../../../lib/llm")>()),
  completeText,
}));
vi.mock("../../user/user.service", async () =>
  (await import("./routeMock.js")).userServiceMock(getUserApiKeys),
);
vi.mock("../../../lib/providerCredentials/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/providerCredentials/index")>()),
  getUserApiKeys,
  getEffectiveApiKeys: (userId: string) => getUserApiKeys(userId),
}));
vi.mock("../../../lib/audit", () => ({ recordAudit }));
import type { Db } from "../../../lib/supabase";
import {
  getPlaybook,
  reviewWithPlaybook,
  updatePlaybookContent,
} from "../playbooks.operations";
import { setPlaybookState } from "../playbooks.state";
import { database, type Row } from "./playbookTestDb";

const ORIGIN = {
  kind: "answer" as const,
  questionIds: ["q6"],
  unbacked: false,
};
const LEGAL_REFS = [{ text: "Art. 1792 CCF", verified: false }];

function content(rules: Row[] = [rule()]) {
  return {
    name: "Arrendamiento",
    description: "",
    representedParty: "",
    documentTypes: [],
    jurisdictions: [],
    rules,
    topics: [],
  };
}

function rule(overrides: Row = {}): Row {
  return {
    id: "rule-1",
    name: "Pena convencional",
    concept: "La pena no excede la obligación principal.",
    scope: "clause",
    required: false,
    guidance: "",
    standard: null,
    fallbacks: [],
    unacceptable: [],
    conditions: [],
    actions: [],
    sourceRefs: [],
    ...overrides,
  };
}

function book(overrides: Row = {}): Row {
  return {
    id: "book",
    user_id: "owner",
    org_id: null,
    visibility: "private",
    shared_with: [],
    name: "Arrendamiento",
    description: "",
    content_json: content([
      rule({ origin: ORIGIN, legalRefs: LEGAL_REFS }),
      rule({ id: "rule-2", name: "Sin respaldo", origin: { kind: "ai_general", unbacked: true } }),
    ]),
    status: "draft",
    is_model: false,
    created_at: "2026-11-07T10:00:00.000Z",
    updated_at: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

function editor(): Row[] {
  return [{ id: "share-editor", playbook_id: "book", shared_with_email: "editor@example.com", role: "editor" }];
}

function withPlaybookTables(db: Db, tables: Record<string, Row[]>, extra: Record<string, Row[]>) {
  Object.assign(tables, extra);
  return db;
}

const audited = (action: string) =>
  recordAudit.mock.calls
    .map(([, event]) => event as { action: string; detail?: unknown })
    .filter((event) => event.action === action);

beforeEach(() => {
  vi.clearAllMocks();
  recordAudit.mockResolvedValue(undefined);
  getUserApiKeys.mockResolvedValue({ claude: "test-key" });
  completeText.mockResolvedValue(JSON.stringify({ summary: "Reviewed", findings: [] }));
});

describe("a draft in reviews", () => {
  const review = (db: Db) =>
    reviewWithPlaybook({
      userId: "owner",
      playbookId: "book",
      documentText: "Contrato",
      model: "claude-opus-5",
      reviewMode: "strict",
      db,
    });

  it("is refused with 409 playbook_draft before a run is recorded", async () => {
    const { db, writes } = database([book()]);
    await expect(review(db)).rejects.toMatchObject({
      status: 409,
      code: "playbook_draft",
      message:
        "Este playbook es un borrador. Un editor debe marcarlo como listo antes de usarlo en revisiones.",
    });
    expect(writes.filter((write) => write.table === "playbook_runs")).toEqual([]);
    expect(completeText).not.toHaveBeenCalled();
  });

  it("reviews a ready playbook as before, without sending provenance to the model", async () => {
    const { db, writes } = database([book({ status: "ready" })]);
    await expect(review(db)).resolves.toMatchObject({ status: "completed" });
    const prompt = JSON.stringify(completeText.mock.calls[0]);
    expect(prompt).toContain("Pena convencional");
    expect(prompt).not.toContain("questionIds");
    expect(prompt).not.toContain("Art. 1792 CCF");
    // The run's snapshot keeps it: which rule, with which origin, was applied.
    const run = writes.find((write) => write.table === "playbook_runs" && write.op === "insert");
    const snapshot = run?.payload.content_json as { rules: Row[] };
    expect(snapshot.rules[0]).toMatchObject({ origin: ORIGIN, legalRefs: LEGAL_REFS });
  });

  it("reads a playbook saved before the column as ready", async () => {
    const legacy = book();
    delete legacy.status;
    delete legacy.is_model;
    const { db } = database([legacy]);
    expect(await getPlaybook("owner", "book", db)).toMatchObject({
      status: "ready",
      isModel: false,
      derivedFromPlaybookId: null,
    });
  });
});

describe("autosave and provenance", () => {
  it("keeps the stored origin and legal references whatever the client sends", async () => {
    const { db, tables } = database([book()]);
    await updatePlaybookContent(
      "owner",
      "book",
      content([
        // Forged: claims a clause and drops "not verified".
        rule({ origin: { kind: "clause", sourceId: "A1", unbacked: false }, legalRefs: [] }),
        // Removed by the client: comes back from the store.
        rule({ id: "rule-2", name: "Sin respaldo" }),
        // A new rule cannot arrive with an origin.
        rule({ id: "rule-new", name: "Nueva", origin: ORIGIN, legalRefs: [{ text: "Ley", verified: true }] }),
      ]),
      db,
    );
    const saved = (tables.playbooks[0].content_json as { rules: Row[] }).rules;
    expect(saved[0]).toMatchObject({ origin: ORIGIN, legalRefs: LEGAL_REFS });
    expect(saved[1]).toMatchObject({ origin: { kind: "ai_general", unbacked: true } });
    expect(saved[1]).not.toHaveProperty("legalRefs");
    expect(saved[2]).not.toHaveProperty("origin");
    expect(saved[2]).not.toHaveProperty("legalRefs");
  });
});

describe("marking ready and as a model", () => {
  it("lets an editor mark a draft ready, recording counts and no rule text", async () => {
    const { db, tables } = database([book({ shared_with: [] })]);
    tables.playbook_shares.push(...editor());
    const playbook = await setPlaybookState("editor", "book", { status: "ready" }, db, "editor@example.com");
    expect(playbook).toMatchObject({ status: "ready", isModel: false });
    expect(tables.playbooks[0].updated_at).not.toBe("2026-11-07T10:00:00.000Z");
    // Rules without backing do not block (open question 2); the row keeps the counts.
    expect(audited("playbook.marked_ready")).toEqual([
      expect.objectContaining({
        detail: { playbook_id: "book", rules: 2, unbacked_rules: 1, unverified_refs: 1 },
      }),
    ]);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Pena convencional");
  });

  it("refuses a viewer", async () => {
    const { db } = database([book({ shared_with: ["reader@example.com"] })]);
    await expect(
      setPlaybookState("reader", "book", { status: "ready" }, db, "reader@example.com"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses while proposed changes await a decision", async () => {
    const { db, tables, writes } = database([book()]);
    withPlaybookTables(db, tables, {
      playbook_changes: [{ id: "change-1", playbook_id: "book", status: "pending" }],
    });
    await expect(setPlaybookState("owner", "book", { status: "ready" }, db)).rejects.toMatchObject({
      status: 409,
      code: "playbook_changes_pending",
    });
    expect(writes.filter((write) => write.op === "update")).toEqual([]);
  });

  it("refuses incomplete content", async () => {
    const { db } = database([book({ content_json: content([rule({ concept: "" })]) })]);
    await expect(setPlaybookState("owner", "book", { status: "ready" }, db)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("marks a ready personal playbook as a model and unmarks it (open question 4)", async () => {
    const { db, tables } = database([book({ status: "ready" })]);
    expect(await setPlaybookState("owner", "book", { isModel: true }, db)).toMatchObject({ isModel: true });
    expect(tables.playbooks[0].is_model).toBe(true);
    expect(await setPlaybookState("owner", "book", { isModel: false }, db)).toMatchObject({ isModel: false });
    expect(audited("playbook.model_marked")).toHaveLength(1);
    expect(audited("playbook.model_unmarked")).toHaveLength(1);
  });

  it("refuses to make a draft a model, unless it is marked ready in the same request", async () => {
    const { db } = database([book()]);
    await expect(setPlaybookState("owner", "book", { isModel: true }, db)).rejects.toMatchObject({
      status: 409,
    });
    expect(await setPlaybookState("owner", "book", { status: "ready", isModel: true }, db)).toMatchObject({
      status: "ready",
      isModel: true,
    });
  });

  it("does not overwrite an edit saved in between", async () => {
    const { db, tables } = database([book()]);
    const racing = {
      from(table: string) {
        // The autosave lands after the state request read the playbook.
        if (table === "playbook_changes") tables.playbooks[0].updated_at = "2026-11-07T10:00:05.000Z";
        return db.from(table as never);
      },
    } as unknown as Db;
    await expect(setPlaybookState("owner", "book", { status: "ready" }, racing)).rejects.toMatchObject({
      status: 409,
    });
    expect(tables.playbooks[0].status).toBe("draft");
  });

  it("refuses a body that is not a state change", async () => {
    const { db } = database([book()]);
    for (const body of [{}, { status: "draft" }, { isModel: "yes" }, { status: "ready", name: "x" }])
      await expect(setPlaybookState("owner", "book", body, db)).rejects.toMatchObject({ status: 400 });
  });
});

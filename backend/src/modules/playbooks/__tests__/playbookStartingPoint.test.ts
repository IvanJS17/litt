// LiTT playbooks with a starting point, layer 1 (T3): "use as a starting
// point". A copy takes the rules and nothing of the original's case; the new
// case's questionnaire becomes changes proposed one by one, checked by the
// server against the copy; the copy is read-only while they are computed;
// each change is accepted or rejected over the rule it was proposed for.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeText, getUserApiKeys, recordAudit, reportError, storage } = vi.hoisted(() => ({
  completeText: vi.fn(),
  getUserApiKeys: vi.fn(),
  recordAudit: vi.fn(),
  reportError: vi.fn(),
  storage: {
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    headFile: vi.fn(),
    uploadFile: vi.fn(),
  },
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
vi.mock("../../../lib/observability/report", async (original) => ({
  ...(await original<typeof import("../../../lib/observability/report")>()),
  reportError,
}));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  ...storage,
}));

import type { DbJob } from "../../../lib/dbq/types";
import type { Db } from "../../../lib/supabase";
import { loadPinnedChatRoute, recordChatEgress } from "../../user/user.service";
import { checkProposalOutput, decidePlaybookChange, listPlaybookChanges } from "../playbooks.changes";
import { copyPlaybook } from "../playbooks.copy";
import {
  handlePlaybookDraft,
  markPlaybookDraftJobFailed,
  queuePlaybookProposals,
} from "../playbooks.jobs";
import { getPlaybook, updatePlaybookContent } from "../playbooks.operations";
import { setPlaybookState } from "../playbooks.state";
import { discardProposal } from "../playbooks.proposals";
import type { PlaybookContent, PlaybookProposalWork } from "../playbooks.types";
import { database, type Row } from "./playbookTestDb";

const MODEL = "claude-opus-5";
const ORIGINAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T0 = "2026-11-01T10:00:00.000Z";
const RED_LINE = "Nunca aceptar renuncia a la garantía de saneamiento.";
const ORIGINAL_ANSWER = "Arrendadora con inmuebles en Monterrey.";
const CLAUSE = "La Arrendataria pagará una pena convencional equivalente a un mes de renta.";

function rule(overrides: Row = {}): Row {
  return {
    name: "Pena convencional",
    concept: "La pena no excede un mes de renta.",
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

const PENA_STANDARD = {
  name: "Estándar",
  criteria: "Un mes de renta",
  sampleClauses: [{ text: CLAUSE, usage: "preferred", sourceRefs: ["P2"] }],
};

const ORIGINAL_CONTENT = {
  name: "Arrendamientos",
  description: "",
  representedParty: "",
  documentTypes: [],
  jurisdictions: [],
  rules: [],
  topics: [
    {
      id: "topic-1",
      name: "Pagos",
      rules: [
        rule({
          id: "r-pena",
          sourceRefs: ["P1"],
          standard: PENA_STANDARD,
          origin: { kind: "clause", sourceId: "src-1", quote: CLAUSE, unbacked: false },
          legalRefs: [{ text: "Art. 1840 CCF", verified: false }],
        }),
        rule({ id: "r-garantia", name: "Garantía", concept: "Depósito de un mes." }),
      ],
    },
  ],
};

function seeded() {
  const fixture = database([
    {
      id: ORIGINAL,
      user_id: "owner",
      name: "Arrendamientos",
      description: "",
      org_id: null,
      visibility: "private",
      content_json: structuredClone(ORIGINAL_CONTENT),
      status: "ready",
      is_model: true,
      derived_from_playbook_id: null,
      intake_json: { answers: { q1: ORIGINAL_ANSWER } },
      source_filename: "Arrendamientos.docx",
      source_storage_key: `playbooks/owner/${ORIGINAL}/source.docx`,
      import_model: MODEL,
      created_at: T0,
      updated_at: T0,
      // The lawyer who uses it as a starting point can only open it.
      shared_with: ["lawyer@example.com"],
    },
  ]);
  fixture.tables.playbook_sources = [
    { id: "src-1", playbook_id: ORIGINAL, filename: "Cláusulas.docx", storage_key: "k", created_at: T0 },
  ];
  return fixture;
}

function job(payload: unknown): DbJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    kind: "playbook.draft",
    payload: payload as Record<string, unknown>,
    status: "running",
    attempts: 1,
    max_attempts: 3,
    run_at: now,
    claimed_at: now,
    finished_at: null,
    last_error: null,
    dedupe_key: null,
    result: null,
    created_at: now,
  };
}

const LAWYER = { id: "lawyer", email: "lawyer@example.com" };

async function copied() {
  const fixture = seeded();
  const copy = await copyPlaybook(LAWYER.id, ORIGINAL, {}, fixture.db, LAWYER.email);
  return { ...fixture, copy };
}

async function proposed(changes: unknown[], answers: Row = { q6: RED_LINE }) {
  const fixture = await copied();
  const attempt = await queuePlaybookProposals({
    userId: LAWYER.id,
    userEmail: LAWYER.email,
    playbookId: fixture.copy.id,
    model: MODEL,
    answers,
    db: fixture.db,
  });
  const work = fixture.tables.db_jobs.at(-1)!.payload as PlaybookProposalWork;
  completeText.mockResolvedValue(JSON.stringify({ changes }));
  return { ...fixture, attempt, work };
}

const modifyPena = {
  op: "modify_rule",
  ruleId: "r-pena",
  // The same standard as the copy's, which the model cannot mark with files.
  after: rule({ concept: "La pena no excede dos meses de renta.", standard: PENA_STANDARD }),
  rationale: "El cliente acepta hasta dos meses.",
  origin: { kind: "answer", questionIds: ["q6"] },
};

function copyRow(tables: Record<string, Row[]>, id: string) {
  return tables.playbooks.find((row) => row.id === id)!;
}

function topicRules(row: Row): Row[] {
  return (row.content_json as PlaybookContent).topics[0].rules as Row[];
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserApiKeys.mockResolvedValue({ claude: "test-key" });
  recordAudit.mockResolvedValue(undefined);
  storage.deleteFile.mockResolvedValue(undefined);
  storage.uploadFile.mockResolvedValue(undefined);
  storage.headFile.mockResolvedValue({ size: 100 });
});

describe("the copy", () => {
  it("takes the rules, as the caller's draft, and nothing of the original's case", async () => {
    const { tables, db } = seeded();
    const before = JSON.stringify(tables.playbooks[0]);

    const copy = await copyPlaybook(LAWYER.id, ORIGINAL, {}, db, LAWYER.email);

    expect(copy).toMatchObject({
      userId: LAWYER.id,
      role: "owner",
      name: "Arrendamientos",
      status: "draft",
      isModel: false,
      derivedFromPlaybookId: ORIGINAL,
      sourceFilename: null,
    });
    const row = copyRow(tables, copy.id);
    expect(row).toMatchObject({
      intake_json: null,
      source_filename: null,
      source_storage_key: null,
      org_id: null,
    });
    const [pena] = topicRules(row);
    // File markers point into the original's file: gone. Provenance stays.
    expect(pena.sourceRefs).toEqual([]);
    expect((pena.standard as { sampleClauses: Row[] }).sampleClauses[0].sourceRefs).toEqual([]);
    expect(pena.origin).toMatchObject({ kind: "clause" });
    expect(JSON.stringify(row)).not.toContain(ORIGINAL_ANSWER);
    // No reference documents, and the original byte for byte as it was.
    expect(tables.playbook_sources).toEqual([expect.objectContaining({ playbook_id: ORIGINAL })]);
    expect(JSON.stringify(tables.playbooks[0])).toBe(before);
    expect(recordAudit.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({
        action: "playbook.copied",
        detail: { playbook_id: copy.id, derived_from_playbook_id: ORIGINAL, rules: 2 },
      }),
    );
  });

  it("is not found for someone who cannot open the original", async () => {
    const { tables, db } = seeded();
    await expect(
      copyPlaybook("stranger", ORIGINAL, {}, db, "stranger@example.com"),
    ).rejects.toMatchObject({ status: 404 });
    expect(tables.playbooks).toHaveLength(1);
  });
});

describe("proposals over the copy", () => {
  it("records the questionnaire on the row, never in the job, and pins the route", async () => {
    const { tables, copy, attempt, work } = await proposed([]);
    expect(attempt).toMatchObject({ kind: "proposal", status: "running", playbookId: copy.id });
    expect(tables.playbook_imports.at(-1)).toMatchObject({
      kind: "proposal",
      playbook_id: copy.id,
      target_updated_at: copy.updatedAt,
      model_provider: "claude",
      credential_ref: "env:claude",
      request_json: { answers: { q6: RED_LINE }, attachments: [] },
    });
    expect(work).toMatchObject({ kind: "proposal", playbookId: copy.id });
    expect(work).not.toHaveProperty("newPlaybookId");
    expect(JSON.stringify(work)).not.toContain(RED_LINE);
    expect(completeText).not.toHaveBeenCalled();
  });

  it("keeps the copy read-only while the changes are computed", async () => {
    const { db, copy } = await proposed([]);
    const refused = { status: 409, code: "playbook_proposals_running" };
    await expect(
      updatePlaybookContent(LAWYER.id, copy.id, copy.content, db, {}, LAWYER.email),
    ).rejects.toMatchObject(refused);
    await expect(
      setPlaybookState(LAWYER.id, copy.id, { status: "ready" }, db, LAWYER.email),
    ).rejects.toMatchObject(refused);
    await expect(
      queuePlaybookProposals({ userId: LAWYER.id, userEmail: LAWYER.email, playbookId: copy.id, model: MODEL, db }),
    ).rejects.toMatchObject(refused);
  });

  it("stores the checked operations as pending changes, never rewriting the copy", async () => {
    const { db, tables, copy, work } = await proposed([
      // The model's own "before" is ignored: it is read from the copy.
      { ...modifyPena, before: rule({ concept: "Inventado" }) },
      // Changes nothing: dropped.
      { op: "modify_rule", ruleId: "r-garantia", after: rule({ name: "Garantía", concept: "Depósito de un mes." }) },
      // No such rule or topic: dropped.
      { op: "modify_rule", ruleId: "r-nope", after: rule() },
      { op: "add_rule", topicId: "topic-404", after: rule({ name: "Nueva" }) },
      { op: "remove_rule", ruleId: "r-garantia", rationale: "No aplica." },
      // A second operation on one rule: dropped.
      { op: "remove_rule", ruleId: "r-pena" },
      // Claims an answer that was never given: lowered to no backing.
      {
        op: "add_rule",
        topicId: "topic-1",
        after: rule({ name: "Saneamiento", concept: "Nunca renunciar al saneamiento." }),
        origin: { kind: "answer", questionIds: ["q9"] },
      },
    ]);
    const original = JSON.stringify(copyRow(tables, copy.id).content_json);

    await handlePlaybookDraft(db, job(work));

    expect(recordChatEgress).toHaveBeenCalledWith(db, expect.objectContaining({ surface: "playbook_proposal" }));
    const changes = await listPlaybookChanges(LAWYER.id, copy.id, db, LAWYER.email);
    expect(changes.map((change) => [change.op, change.ruleId, change.status])).toEqual([
      ["modify_rule", "r-pena", "pending"],
      ["remove_rule", "r-garantia", "pending"],
      ["add_rule", "proposed-rule-1", "pending"],
    ]);
    expect(changes[0].before).toEqual(copy.content.topics[0].rules[0]);
    expect(changes[0].changedFields).toEqual(["concept"]);
    expect(changes[0].after?.origin).toEqual({ kind: "answer", questionIds: ["q6"], unbacked: false });
    expect(changes[2]).toMatchObject({ topicId: "topic-1", before: null });
    expect(changes[2].after?.origin).toEqual({ kind: "ai_general", unbacked: true });

    // The copy's rules are untouched; it keeps the new case's answers.
    const row = copyRow(tables, copy.id);
    expect(JSON.stringify(row.content_json)).toBe(original);
    expect(row.updated_at).toBe(copy.updatedAt);
    expect(row.intake_json).toMatchObject({ answers: { q6: RED_LINE } });
    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "completed", request_json: null });
    expect(recordAudit.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({
        action: "playbook.proposals_ready",
        status: "completed",
        detail: expect.objectContaining({
          import_id: work.attemptId,
          playbook_id: copy.id,
          changes: 3,
          added: 1,
          modified: 1,
          removed: 1,
          discarded: 4,
          downgraded_rules: 1,
          answered_questions: 1,
        }),
      }),
    );

    // A job that runs again (its first outcome lost) does not store the
    // changes twice.
    Object.assign(tables.playbook_imports.at(-1)!, {
      status: "running",
      request_json: { answers: { q6: RED_LINE }, attachments: [] },
    });
    await handlePlaybookDraft(db, job(work));
    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "completed" });
    expect(tables.playbook_changes).toHaveLength(3);

    // Done computing: the copy can be edited again.
    await expect(
      updatePlaybookContent(LAWYER.id, copy.id, copy.content, db, {}, LAWYER.email),
    ).resolves.toMatchObject({ id: copy.id });
  });

  it("keeps at most 40 changes from one proposal", () => {
    const content = structuredClone(ORIGINAL_CONTENT) as unknown as PlaybookContent;
    const changes = Array.from({ length: 45 }, (_, index) => ({
      op: "add_rule",
      topicId: null,
      after: rule({ name: `Regla ${index}` }),
    }));
    const result = checkProposalOutput(JSON.stringify({ changes }), { content, answers: {}, sources: [] });
    expect(result.changes).toHaveLength(40);
    expect(result.counts.discarded).toBe(5);
    expect(new Set(result.changes.map((change) => change.ruleId)).size).toBe(40);
  });

  it("refuses a ready playbook and asks no model", async () => {
    const { db } = seeded();
    // The lawyer owns a ready playbook of their own.
    await expect(
      queuePlaybookProposals({ userId: "owner", playbookId: ORIGINAL, model: MODEL, db }),
    ).rejects.toMatchObject({ status: 409, code: "playbook_not_draft" });
    expect(completeText).not.toHaveBeenCalled();
  });

  it("fails after one repair on an invalid answer, leaving the copy as it was", async () => {
    const { db, tables, copy, work } = await proposed([]);
    completeText.mockResolvedValue("No puedo ayudar con eso.");

    await handlePlaybookDraft(db, job(work));

    expect(completeText).toHaveBeenCalledTimes(2);
    expect(tables.playbook_changes ?? []).toEqual([]);
    expect(copyRow(tables, copy.id)).toMatchObject({ status: "draft", intake_json: null });
    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "failed", request_json: null });
    expect(recordAudit.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({ action: "playbook.proposals_ready", status: "failed" }),
    );
  });

  it("fails closed when the pinned key is gone, asking no other model", async () => {
    const { db, tables, work } = await proposed([modifyPena]);
    vi.mocked(loadPinnedChatRoute).mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: "chat_route_credential_unavailable",
      detail: "The key this conversation was started with is no longer available.",
    } as never);

    await handlePlaybookDraft(db, job(work));

    expect(completeText).not.toHaveBeenCalled();
    expect(tables.playbook_changes ?? []).toEqual([]);
    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "failed", request_json: null });
  });

  it("never discards the copy when a proposal's retries run out", async () => {
    const { db, tables, copy, work } = await proposed([modifyPena]);
    // Stored, but the row never recorded its outcome.
    await handlePlaybookDraft(db, job(work));
    Object.assign(tables.playbook_imports.at(-1)!, { status: "running" });

    await markPlaybookDraftJobFailed(db, job(work));

    expect(copyRow(tables, copy.id)).toMatchObject({ status: "draft" });
    expect(tables.playbook_changes).toEqual([]);
    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "failed", request_json: null });
  });
});

describe("deciding each change", () => {
  async function computed() {
    const fixture = await proposed([
      modifyPena,
      { op: "remove_rule", ruleId: "r-garantia" },
      { op: "add_rule", topicId: "topic-1", after: rule({ name: "Saneamiento", concept: "Nunca renunciar." }) },
    ]);
    await handlePlaybookDraft(fixture.db, job(fixture.work));
    const changes = await listPlaybookChanges(LAWYER.id, fixture.copy.id, fixture.db, LAWYER.email);
    recordAudit.mockClear();
    return { ...fixture, changes };
  }
  const decide = (db: Db, playbookId: string, changeId: string, decision: string) =>
    decidePlaybookChange(LAWYER.id, playbookId, changeId, { decision }, db, LAWYER.email);

  it("applies each accepted change and records it once", async () => {
    const { db, tables, copy, changes } = await computed();
    const [modify, remove, add] = changes;

    const first = await decide(db, copy.id, modify.id, "accept");
    expect(first.change).toMatchObject({ status: "accepted", decidedBy: LAWYER.id });
    expect(first.playbook.content.topics[0].rules[0]).toMatchObject({
      id: "r-pena",
      concept: "La pena no excede dos meses de renta.",
      origin: { kind: "answer", questionIds: ["q6"] },
    });
    // A second click finds it decided and applies nothing.
    await expect(decide(db, copy.id, modify.id, "accept")).rejects.toMatchObject({
      status: 409,
      code: "playbook_change_decided",
    });

    await decide(db, copy.id, remove.id, "accept");
    await decide(db, copy.id, add.id, "accept");
    expect(topicRules(copyRow(tables, copy.id)).map((rule) => rule.id)).toEqual([
      "r-pena",
      "proposed-rule-1",
    ]);
    expect(recordAudit.mock.calls.map(([, event]) => event.action)).toEqual([
      "playbook.change_accepted",
      "playbook.change_accepted",
      "playbook.change_accepted",
    ]);
    const audited = JSON.stringify(recordAudit.mock.calls);
    expect(audited).not.toContain("dos meses");
    expect(audited).not.toContain(RED_LINE);
  });

  it("leaves the rules untouched when a change is rejected", async () => {
    const { db, tables, copy, changes } = await computed();
    const before = JSON.stringify(copyRow(tables, copy.id).content_json);

    const { change } = await decide(db, copy.id, changes[0].id, "reject");

    expect(change).toMatchObject({ status: "rejected", decidedBy: LAWYER.id });
    expect(JSON.stringify(copyRow(tables, copy.id).content_json)).toBe(before);
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      action: "playbook.change_rejected",
      detail: { playbook_id: copy.id, change_id: changes[0].id, op: "modify_rule", rule_id: "r-pena" },
    });
  });

  it("answers playbook_change_stale for a rule edited after the proposal, and keeps it pending", async () => {
    const { db, tables, copy, changes } = await computed();
    const current = await getPlaybook(LAWYER.id, copy.id, db, LAWYER.email);
    const edited = structuredClone(current.content);
    edited.topics[0].rules[0].guidance = "Editada a mano.";
    await updatePlaybookContent(LAWYER.id, copy.id, edited, db, {}, LAWYER.email);

    await expect(decide(db, copy.id, changes[0].id, "accept")).rejects.toMatchObject({
      status: 409,
      code: "playbook_change_stale",
    });
    const row = tables.playbook_changes.find((change) => change.id === changes[0].id)!;
    expect(row.status).toBe("pending");
    expect(row.decided_by ?? null).toBeNull();
    expect(row.decided_at ?? null).toBeNull();
    expect(topicRules(copyRow(tables, copy.id))[0].guidance).toBe("Editada a mano.");
  });

  it("keeps the change pending when another save lands meanwhile", async () => {
    const { db, tables, copy, changes } = await computed();
    // Another save lands between the accept's read and its transaction.
    const racing = {
      from: db.from,
      rpc(name: string, args: Row) {
        copyRow(tables, copy.id).updated_at = "2026-11-07T00:00:00.000Z";
        return db.rpc(name, args);
      },
    } as unknown as Db;

    await expect(decide(racing, copy.id, changes[0].id, "accept")).rejects.toMatchObject({
      status: 409,
      code: "playbook_change_stale",
    });
    expect(tables.playbook_changes.find((change) => change.id === changes[0].id)).toMatchObject({
      status: "pending",
    });
    expect(topicRules(copyRow(tables, copy.id))[0].concept).toBe("La pena no excede un mes de renta.");
  });

  // W1: accepting and marking ready at once. Accepting claims the change and
  // saves the rules in one transaction (accept_playbook_change), so marking
  // ready sees either the change pending (and refuses) or the rules saved
  // (and its version is gone): never a ready copy with a pending change.
  it("never leaves a ready copy with a pending change when accept and ready interleave", async () => {
    const fixture = await proposed([modifyPena]);
    await handlePlaybookDraft(fixture.db, job(fixture.work));
    const { db, tables, copy } = fixture;
    const [change] = await listPlaybookChanges(LAWYER.id, copy.id, db, LAWYER.email);
    const ready = (on: Db) => setPlaybookState(LAWYER.id, copy.id, { status: "ready" }, on, LAWYER.email);

    // Ready runs after the accept has read the rules, before it commits.
    let refused: unknown;
    const readyInside = {
      from: db.from,
      async rpc(name: string, args: Row) {
        refused = await ready(db).catch((error: unknown) => error);
        return db.rpc(name, args);
      },
    } as unknown as Db;
    await decide(readyInside, copy.id, change.id, "accept");
    expect(refused).toMatchObject({ status: 409, code: "playbook_changes_pending" });
    expect(copyRow(tables, copy.id).status).toBe("draft");
    expect(tables.playbook_changes[0].status).toBe("accepted");

    // Ready has read the copy when the accept commits.
    const again = await proposed([modifyPena]);
    await handlePlaybookDraft(again.db, job(again.work));
    const [second] = await listPlaybookChanges(LAWYER.id, again.copy.id, again.db, LAWYER.email);
    let accepted = false;
    const acceptInside = {
      from(table: string) {
        if (table === "playbook_changes" && !accepted) {
          accepted = true;
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => {
                    await decide(again.db, again.copy.id, second.id, "accept");
                    return again.db.from("playbook_changes").select("id").eq("playbook_id", again.copy.id).eq("status", "pending").limit(1);
                  },
                }),
              }),
            }),
          };
        }
        return again.db.from(table as never);
      },
      rpc: again.db.rpc,
    } as unknown as Db;
    await expect(
      setPlaybookState(LAWYER.id, again.copy.id, { status: "ready" }, acceptInside, LAWYER.email),
    ).rejects.toMatchObject({ status: 409 });
    expect(accepted).toBe(true);
    expect(copyRow(again.tables, again.copy.id).status).toBe("draft");
    expect(again.tables.playbook_changes[0].status).toBe("accepted");
  });

  it("lets a reader list the changes but not decide them", async () => {
    const { db, tables, copy, changes } = await computed();
    tables.playbook_shares.push({
      id: "share-reader",
      playbook_id: copy.id,
      shared_with_email: "reader@example.com",
      role: "viewer",
    });
    await expect(
      listPlaybookChanges("reader", copy.id, db, "reader@example.com"),
    ).resolves.toHaveLength(3);
    await expect(
      decidePlaybookChange("reader", copy.id, changes[0].id, { decision: "reject" }, db, "reader@example.com"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      listPlaybookChanges("stranger", copy.id, db, "stranger@example.com"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("marks the copy ready only once every change is decided", async () => {
    const { db, copy, changes } = await computed();
    await expect(
      setPlaybookState(LAWYER.id, copy.id, { status: "ready" }, db, LAWYER.email),
    ).rejects.toMatchObject({ status: 409, code: "playbook_changes_pending" });
    // Nor can more be asked for while these wait.
    await expect(
      queuePlaybookProposals({ userId: LAWYER.id, userEmail: LAWYER.email, playbookId: copy.id, model: MODEL, db }),
    ).rejects.toMatchObject({ status: 409, code: "playbook_changes_pending" });

    for (const change of changes) await decide(db, copy.id, change.id, "reject");

    await expect(
      setPlaybookState(LAWYER.id, copy.id, { status: "ready" }, db, LAWYER.email),
    ).resolves.toMatchObject({ status: "ready" });
  });
});

// The guards the T3 review asked for (W3, W4, W6, I1).
describe("a proposal's guards", () => {
  const ask = (db: Db, playbookId: string) =>
    queuePlaybookProposals({ userId: LAWYER.id, userEmail: LAWYER.email, playbookId, model: MODEL, db });

  it("starts one proposal per copy when two requests race past the checks", async () => {
    const { db, tables, copy } = await copied();
    // The second request runs whole while the first is about to insert.
    let raced = false;
    const racing = {
      from(table: string) {
        const query = db.from(table as never) as unknown as Record<string, unknown>;
        if (table !== "playbook_imports" || raced) return query;
        const insert = query.insert as (value: Row) => PromiseLike<unknown>;
        query.insert = (value: Row) => {
          raced = true;
          return {
            then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
              ask(db, copy.id).then(() => insert(value)).then(resolve, reject),
          };
        };
        return query;
      },
      rpc: db.rpc,
    } as unknown as Db;

    await expect(ask(racing, copy.id)).rejects.toMatchObject({
      status: 409,
      code: "playbook_proposals_running",
    });
    expect(raced).toBe(true);
    expect(
      tables.playbook_imports.filter((row) => row.kind === "proposal" && row.status === "running"),
    ).toHaveLength(1);
  });

  it("ends a proposal that will never finish before starting the next one", async () => {
    const { db, tables, copy } = await copied();
    // Silent for hours and with no job left: interrupted.
    (tables.playbook_imports ??= []).push({
      id: "lost",
      kind: "proposal",
      status: "running",
      stage: "compiling",
      playbook_id: copy.id,
      user_id: LAWYER.id,
      org_id: null,
      model: MODEL,
      target_updated_at: copy.updatedAt,
      started_at: T0,
      updated_at: T0,
    });
    tables.playbook_changes = [
      { id: "c-lost", playbook_id: copy.id, import_id: "lost", status: "pending", op: "remove_rule", rule_id: "r-garantia" },
    ];

    await expect(ask(db, copy.id)).resolves.toMatchObject({ status: "running" });

    expect(tables.playbook_imports.find((row) => row.id === "lost")).toMatchObject({
      status: "failed",
      request_json: null,
    });
    expect(tables.playbook_changes).toEqual([]);
    expect(
      tables.playbook_imports.filter((row) => row.kind === "proposal" && row.status === "running"),
    ).toHaveLength(1);
    expect(recordAudit.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({
        action: "playbook.proposals_ready",
        status: "failed",
        title: "Arrendamientos",
        detail: { import_id: "lost", playbook_id: copy.id, stage: "compiling" },
      }),
    );
  });

  it("keeps the documents of a copy marked ready meanwhile, and never another playbook's", async () => {
    const { db, tables, copy, work } = await proposed([]);
    tables.playbook_sources.push({
      id: "src-new",
      playbook_id: copy.id,
      filename: "Caso.docx",
      storage_key: "copy-key",
      created_at: T0,
    });
    const mine = { ...work, sourceIds: ["src-new"] };

    copyRow(tables, copy.id).status = "ready";
    await discardProposal(db, mine);
    expect(tables.playbook_sources.map((row) => row.id)).toEqual(["src-1", "src-new"]);
    expect(storage.deleteFile).not.toHaveBeenCalled();

    // Still a draft: only its own rows go, and only their files. src-1 is
    // the original's.
    copyRow(tables, copy.id).status = "draft";
    await discardProposal(db, { ...mine, sourceIds: ["src-new", "src-1"] });
    expect(tables.playbook_sources.map((row) => row.id)).toEqual(["src-1"]);
    expect(storage.deleteFile.mock.calls).toEqual([["copy-key"]]);
  });

  it("leaves the copy's answers as they were when it fails at the last step", async () => {
    const { db, tables, copy, work } = await proposed([modifyPena]);
    const earlier = { answers: { q1: "Caso anterior." } };
    copyRow(tables, copy.id).intake_json = earlier;
    // Recording the outcome fails, after every change was stored.
    const failing = {
      from(table: string) {
        const query = db.from(table as never) as unknown as Record<string, unknown>;
        if (table !== "playbook_imports") return query;
        const update = query.update as (value: Row) => unknown;
        query.update = (value: Row) => {
          if (value.status !== "completed") return update(value);
          const lost = {
            eq: () => lost,
            select: async () => ({ data: null, error: new Error("connection lost") }),
          };
          return lost;
        };
        return query;
      },
      rpc: db.rpc,
    } as unknown as Db;

    await handlePlaybookDraft(failing, job(work));

    expect(copyRow(tables, copy.id).intake_json).toEqual(earlier);
    expect(tables.playbook_changes).toEqual([]);
    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "failed", request_json: null });
    // The failed outcome carries the copy's name, as every playbook row.
    expect(recordAudit.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({
        action: "playbook.proposals_ready",
        status: "failed",
        title: "Arrendamientos",
      }),
    );
  });

  it("keeps the proposal when only the write of its answers is lost, and reports a warning", async () => {
    const { db, tables, copy, work } = await proposed([modifyPena]);
    const earlier = { answers: { q1: "Caso anterior." } };
    copyRow(tables, copy.id).intake_json = earlier;
    // Only the update that keeps the new case's answers is lost.
    const losingIntake = {
      from(table: string) {
        const query = db.from(table as never) as unknown as Record<string, unknown>;
        if (table !== "playbooks") return query;
        const update = query.update as (value: Row) => unknown;
        query.update = (value: Row) => {
          if (!("intake_json" in value)) return update(value);
          const lost = {
            eq: () => lost,
            select: async () => ({ data: null, error: new Error("connection lost") }),
          };
          return lost;
        };
        return query;
      },
      rpc: db.rpc,
    } as unknown as Db;

    await handlePlaybookDraft(losingIntake, job(work));

    expect(tables.playbook_imports.at(-1)).toMatchObject({ status: "completed", request_json: null });
    expect(tables.playbook_changes.map((change) => [change.rule_id, change.status])).toEqual([
      ["r-pena", "pending"],
    ]);
    expect(copyRow(tables, copy.id).intake_json).toEqual(earlier);
    expect(
      reportError.mock.calls.filter(([, context]) => context?.tags?.stage === "import.record"),
    ).toEqual([
      [
        expect.anything(),
        expect.objectContaining({
          level: "warning",
          extra: { import_id: work.attemptId, playbook_id: copy.id },
        }),
      ],
    ]);
    expect(recordAudit.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({ action: "playbook.proposals_ready", status: "completed" }),
    );
  });
});

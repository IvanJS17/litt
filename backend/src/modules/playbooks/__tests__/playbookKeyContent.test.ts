// A firm's key runs only that firm's content. Every flow that takes content
// (a saved document to import, the attachments of a draft or of proposals)
// refuses a chosen firm key when a document is of another firm or personal.
// A person's own key is not affected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

vi.mock("../../documents/documents.service", async (original) => ({
  ...(await original<typeof import("../../documents/documents.service")>()),
  getFileStreamSource: vi.fn(async () => ({
    ok: true,
    storagePath: "stored/a.docx",
    fileType: "docx",
    size: 10,
    filename: "a.docx",
    held: false,
  })),
}));

import { beginPlaybookDraft } from "../playbooks.draft";
import { beginPlaybookProposals } from "../playbooks.proposals";
import { queuePlaybookImport } from "../playbooks.jobs";
import {
  assertFirmKeyForDocuments,
  beginPlaybookImport,
  blankPlaybookContent,
} from "../playbooks.operations";
import { database, ORG as FIRM_A, OTHER as FIRM_B, type Row } from "./playbookTestDb";
import { keyRow } from "./playbookTestKeys";

const DOC_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIRM_A_KEY = `org:${FIRM_A}:claude:v1`;
const OWN_KEY = "user:u1:claude:v1";

/** A person in two firms with a key of firm A and their own; documents by org. */
async function world(documentOrgs: Record<string, string | null>): Promise<Db> {
  const { db, tables } = database(
    [
      {
        id: "copy",
        user_id: "u1",
        org_id: FIRM_A,
        visibility: "organization",
        status: "draft",
        name: "Guide",
        description: "",
        content_json: blankPlaybookContent("Guide"),
        created_at: "2026-10-17",
        updated_at: "2026-10-17",
      },
    ],
    [
      { user_id: "u1", org_id: FIRM_A, role: "member" },
      { user_id: "u1", org_id: FIRM_B, role: "member" },
    ],
  );
  tables.organizations!.forEach((row) => {
    row.allow_personal_ai_keys = true;
    row.authorization_epoch = 1;
  });
  tables.org_api_keys = [await keyRow({ kind: "org", id: FIRM_A }, "sk-firm-a")];
  tables.user_api_keys = [await keyRow({ kind: "user", id: "u1" }, "sk-own")];
  tables.documents = Object.entries(documentOrgs).map(
    ([id, org_id]): Row => ({ id, org_id, user_id: "u1", project_id: null }),
  );
  return db;
}

type Flow = (db: Db, ref: string, documents: string[]) => Promise<unknown>;

/**
 * How a refused key shows. The draft and the proposals answer 409 with the
 * code; an import is recorded as failed at the model check and carries the
 * same sentence, as for every other refusal of its key.
 */
const refusedAs = (flow: string) =>
  flow.startsWith("import")
    ? { stage: "checking_model", message: expect.stringContaining("no longer available") }
    : { code: "chat_route_credential_unavailable" };

const FLOWS: Array<[string, Flow]> = [
  [
    "import from a saved document",
    (db, ref, [documentId]) =>
      beginPlaybookImport({
        userId: "u1",
        filename: "a.docx",
        size: 10,
        model: "claude-opus-5",
        workspace: FIRM_A,
        documentId,
        credentialRef: ref,
        db,
      }),
  ],
  [
    "draft attachments",
    (db, ref, documents) =>
      beginPlaybookDraft({
        userId: "u1",
        model: "claude-opus-5",
        answers: {},
        workspace: FIRM_A,
        attachments: documents.map((documentId) => ({ documentId })),
        credentialRef: ref,
        db,
      }),
  ],
  [
    "proposal attachments",
    (db, ref, documents) =>
      beginPlaybookProposals({
        userId: "u1",
        playbookId: "copy",
        model: "claude-opus-5",
        answers: {},
        attachments: documents.map((documentId) => ({ documentId })),
        credentialRef: ref,
        db,
      }),
  ],
];

beforeEach(() => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe.each(FLOWS)("%s", (flow, run) => {
  it("runs on the firm's key for the firm's own documents", async () => {
    await expect(run(await world({ [DOC_1]: FIRM_A }), FIRM_A_KEY, [DOC_1])).resolves.toBeTruthy();
  });

  it.each([
    ["a document of another firm", FIRM_B],
    ["a personal document", null],
  ])("refuses the firm's key for %s", async (_name, documentOrg) => {
    await expect(
      run(await world({ [DOC_1]: documentOrg }), FIRM_A_KEY, [DOC_1]),
    ).rejects.toMatchObject(refusedAs(flow));
  });

  it("refuses the firm's key when only one of several documents is not the firm's", async () => {
    const attached = run === FLOWS[0]![1] ? [DOC_2] : [DOC_1, DOC_2];
    await expect(
      run(await world({ [DOC_1]: FIRM_A, [DOC_2]: FIRM_B }), FIRM_A_KEY, attached),
    ).rejects.toMatchObject(refusedAs(flow));
  });

  it("leaves the person's own key as before, whatever the documents' firm", async () => {
    await expect(run(await world({ [DOC_1]: FIRM_B }), OWN_KEY, [DOC_1])).resolves.toBeTruthy();
    await expect(run(await world({ [DOC_1]: null }), OWN_KEY, [DOC_1])).resolves.toBeTruthy();
  });
});

describe("the key rule on the paths that reach it", () => {
  it("refuses a queued import of another firm's saved document on the firm's key, and queues nothing", async () => {
    const db = await world({ [DOC_1]: FIRM_B });
    await expect(
      queuePlaybookImport({
        userId: "u1",
        model: "claude-opus-5",
        workspace: FIRM_A,
        credentialRef: FIRM_A_KEY,
        source: { documentId: DOC_1 },
        db,
      }),
    ).rejects.toMatchObject({
      stage: "checking_model",
      message: expect.stringContaining("no longer available"),
    });
    const { data } = await db.from("db_jobs").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("refuses the firm's key for a document id that has no row", async () => {
    const db = await world({ [DOC_1]: FIRM_A });
    await expect(
      assertFirmKeyForDocuments(db, FIRM_A_KEY, FIRM_A, [DOC_2]),
    ).rejects.toMatchObject({ status: 409, code: "chat_route_credential_unavailable" });
    await expect(assertFirmKeyForDocuments(db, FIRM_A_KEY, FIRM_A, [DOC_1])).resolves.toBeUndefined();
    await expect(assertFirmKeyForDocuments(db, OWN_KEY, FIRM_A, [DOC_2])).resolves.toBeUndefined();
  });
});

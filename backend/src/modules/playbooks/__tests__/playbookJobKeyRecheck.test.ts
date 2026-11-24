// A firm's key runs only that firm's content, also when the queued job runs:
// a saved document can be assigned to another organization's project while
// the job waits. The import, draft and proposals runners check the rule
// again before any document is read, and nothing reaches the model if the
// key can no longer be used for it.
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeText, recordAudit, storage } = vi.hoisted(() => ({
  completeText: vi.fn(),
  recordAudit: vi.fn(),
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
vi.mock("../../../lib/audit", () => ({ recordAudit }));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  ...storage,
}));
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

import type { Db } from "../../../lib/supabase";
import { beginPlaybookDraft, compilePlaybookDraft } from "../playbooks.draft";
import { beginPlaybookProposals, compilePlaybookProposals } from "../playbooks.proposals";
import { beginPlaybookImport, blankPlaybookContent, compilePlaybookImport } from "../playbooks.operations";
import { database, ORG as FIRM_A, OTHER as FIRM_B, type Row } from "./playbookTestDb";
import { keyRow } from "./playbookTestKeys";

const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRM_A_KEY = `org:${FIRM_A}:claude:v1`;
const MODEL = "claude-opus-5";

async function world() {
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
  tables.documents = [{ id: DOC, org_id: FIRM_A, user_id: "u1", project_id: null } as Row];
  return { db: db as Db, tables };
}

async function docx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Liability is capped at fees paid.</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) vi.stubEnv(name, "");
  completeText.mockResolvedValue("not a playbook");
  recordAudit.mockResolvedValue(undefined);
  storage.deleteFile.mockResolvedValue(undefined);
  storage.uploadFile.mockResolvedValue(undefined);
  storage.headFile.mockResolvedValue({ size: 100 });
  storage.downloadFile.mockResolvedValue(await docx());
});
afterEach(() => vi.unstubAllEnvs());

const moveDocumentToOtherFirm = (tables: Record<string, Row[]>) => {
  tables.documents![0]!.org_id = FIRM_B;
};

type Runner = {
  /** Queue the work as the request does, then return how to run it. */
  queue: (db: Db) => Promise<(db: Db) => Promise<unknown>>;
  /** Whether any document content was read. */
  read: () => number;
};

const IMPORT_READ = vi.fn();

const RUNNERS: Array<[string, Runner]> = [
  [
    "import from a saved document",
    {
      queue: async (db) => {
        const { work } = await beginPlaybookImport({
          userId: "u1",
          filename: "a.docx",
          size: 10,
          model: MODEL,
          workspace: FIRM_A,
          documentId: DOC,
          credentialRef: FIRM_A_KEY,
          db,
        });
        return (runDb) =>
          compilePlaybookImport(runDb, { ...work, documentId: DOC }, async () => {
            IMPORT_READ();
            return Buffer.from(await docx());
          }, { completeText });
      },
      read: () => IMPORT_READ.mock.calls.length,
    },
  ],
  [
    "draft with an attached document",
    {
      queue: async (db) => {
        const { work } = await beginPlaybookDraft({
          userId: "u1",
          model: MODEL,
          answers: {},
          workspace: FIRM_A,
          attachments: [{ documentId: DOC }],
          credentialRef: FIRM_A_KEY,
          db,
        });
        return (runDb) =>
          compilePlaybookDraft(runDb, work, { answers: {}, attachments: [{ documentId: DOC }] }, { completeText });
      },
      read: () => storage.downloadFile.mock.calls.length,
    },
  ],
  [
    "proposals with an attached document",
    {
      queue: async (db) => {
        const { work } = await beginPlaybookProposals({
          userId: "u1",
          playbookId: "copy",
          model: MODEL,
          answers: {},
          attachments: [{ documentId: DOC }],
          credentialRef: FIRM_A_KEY,
          db,
        });
        return (runDb) =>
          compilePlaybookProposals(runDb, work, { answers: {}, attachments: [{ documentId: DOC }] }, { completeText });
      },
      read: () => storage.downloadFile.mock.calls.length,
    },
  ],
];

describe.each(RUNNERS)("the %s runner", (_flow, runner) => {
  beforeEach(() => IMPORT_READ.mockClear());

  it("ends the job refused, reading nothing and asking no model, when the document moved to another firm while it waited", async () => {
    const { db, tables } = await world();
    const run = await runner.queue(db);
    moveDocumentToOtherFirm(tables);

    await run(db).catch(() => undefined);

    expect(runner.read()).toBe(0);
    expect(completeText).not.toHaveBeenCalled();
    expect(tables.playbook_imports![0]).toMatchObject({
      status: "failed",
      stage: "checking_model",
      error: expect.stringContaining("no longer available"),
    });
  });

  it("runs as before when the document is still the firm's", async () => {
    const { db, tables } = await world();
    const run = await runner.queue(db);

    await run(db).catch(() => undefined);

    expect(runner.read()).toBeGreaterThan(0);
    expect(completeText).toHaveBeenCalled();
    expect(tables.playbook_imports![0]!.error ?? "").not.toContain("no longer available");
  });
});

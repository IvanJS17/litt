// run_playbook starts a review only on a key reference it is handed (the
// conversation's, or the route a subagent runs on); with none it refuses and
// starts nothing, whatever other keys the person or the deployment has. The dispatcher is real; the review is the
// real start of a review (key and content rules included) over an in-memory
// database, stopped before any model call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../../lib/supabase";

const docs = vi.hoisted(() => ({
  loadActiveVersion: vi.fn(),
  loadCurrentVersionBytes: vi.fn(),
  extractDocxBodyText: vi.fn(),
}));
const started = vi.hoisted(() => ({ credentialRefs: [] as unknown[] }));
vi.mock("../../../documents/documents.service", async (original) => ({
  ...(await original<typeof import("../../../documents/documents.service")>()),
  loadCurrentVersionBytes: docs.loadCurrentVersionBytes,
}));
vi.mock("../../../../lib/documentVersions", async (original) => ({
  ...(await original<typeof import("../../../../lib/documentVersions")>()),
  loadActiveVersion: docs.loadActiveVersion,
}));
vi.mock("../../../../lib/docxTrackedChanges", async (original) => ({
  ...(await original<typeof import("../../../../lib/docxTrackedChanges")>()),
  extractDocxBodyText: docs.extractDocxBodyText,
}));
// The review itself is the real beginPlaybookReview; only the run that
// would follow it (the model call) is replaced.
vi.mock("../../../playbooks/playbooks.service", async (original) => {
  const real = await original<typeof import("../../../playbooks/playbooks.service")>();
  const operations = await vi.importActual<typeof import("../../../playbooks/playbooks.operations")>(
    "../../../playbooks/playbooks.operations",
  );
  return {
    ...real,
    reviewWithPlaybook: async (args: Parameters<typeof operations.beginPlaybookReview>[0]) => {
      const begun = await operations.beginPlaybookReview(args);
      started.credentialRefs.push(begun.resolved.route.credentialRef);
      return { id: "run-1", summary: "", editedVersionId: null, editedVersionNumber: null, findings: [] };
    },
  };
});

import { runToolCalls } from "../tools/toolDispatcher";
import { blankPlaybookContent } from "../../../playbooks/playbooks.operations";
import { keyRow } from "../../../playbooks/__tests__/playbookTestKeys";
import { database, ORG as FIRM_A, OTHER as FIRM_B } from "../../../playbooks/__tests__/playbookTestDb";

const FIRM_A_KEY = `org:${FIRM_A}:claude:v1`;

/** A person in two firms with a key of firm A and their own. */
async function world(documentOrg: string | null, playbookOrg: string | null = FIRM_A, ownKey = true) {
  const { db, tables } = database(
    [
      {
        id: "book",
        user_id: playbookOrg ? "owner" : "u1",
        org_id: playbookOrg,
        visibility: playbookOrg ? "organization" : "private",
        status: "ready",
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
  tables.user_api_keys = ownKey ? [await keyRow({ kind: "user", id: "u1" }, "sk-own")] : [];
  tables.documents = [
    { id: "doc", user_id: "u1", project_id: null, workflow_id: null, org_id: documentOrg },
  ];
  return db;
}

async function runTool(db: Db, credentialRef?: string | null, live?: string) {
  const docStore = new Map([["doc-0", live === undefined ? { filename: "msa.docx", file_type: "docx" } : { filename: "open.docx", file_type: "txt", inline_text: live }]]) as never;
  const docIndex = (live === undefined ? { "doc-0": { document_id: "doc", version_id: "v1", version_number: 1 } } : {}) as never;
  const result = await runToolCalls(
    [{ id: "t1", function: { name: "run_playbook", arguments: JSON.stringify({ playbook_id: "book", doc_id: "doc-0" }) } }],
    docStore, "u1", db, vi.fn(), undefined, undefined, docIndex, new Map() as never, undefined,
    undefined, undefined,
    {
      userEmail: "u1@example.com",
      model: "claude-opus-5",
      ...(credentialRef === undefined ? {} : { credentialRef }),
    } as never,
  );
  return JSON.parse((result.toolResults[0] as { content: string }).content) as Record<string, unknown>;
}

beforeEach(() => {
  started.credentialRefs.length = 0;
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) vi.stubEnv(name, "");
  docs.loadActiveVersion.mockResolvedValue({ id: "v1", filename: "msa.docx", file_type: "docx" });
  docs.loadCurrentVersionBytes.mockResolvedValue({ bytes: Buffer.from(""), storage_path: "p" });
  docs.extractDocxBodyText.mockResolvedValue("Contract text");
});
afterEach(() => vi.unstubAllEnvs());

const KEY_SENTENCE = /Choose which key this conversation should use/;

describe("run_playbook without a key reference", () => {
  it("refuses and starts nothing when the person also has an own key", async () => {
    const answer = await runTool(await world(FIRM_A, FIRM_A, true));
    expect(String(answer.error)).toMatch(KEY_SENTENCE);
    expect(started.credentialRefs).toEqual([]);
  });
  it("refuses and starts nothing when a deployment key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-deployment-key");
    const answer = await runTool(await world(FIRM_A, FIRM_A, false));
    expect(String(answer.error)).toMatch(KEY_SENTENCE);
    expect(started.credentialRefs).toEqual([]);
  });
  it("refuses and starts nothing when no key exists at all", async () => {
    const answer = await runTool(await world(FIRM_A, FIRM_A, false));
    expect(String(answer.error)).toMatch(KEY_SENTENCE);
    expect(started.credentialRefs).toEqual([]);
  });
  it("refuses a null reference the same way", async () => {
    const answer = await runTool(await world(FIRM_A, FIRM_A, true), null);
    expect(String(answer.error)).toMatch(KEY_SENTENCE);
    expect(started.credentialRefs).toEqual([]);
  });
});

describe("run_playbook in a subagent on the conversation's model (conversation pinned to firm A's key)", () => {
  it("reviews firm A's document on firm A's key", async () => {
    await runTool(await world(FIRM_A, FIRM_A, true), FIRM_A_KEY);
    expect(started.credentialRefs).toEqual([FIRM_A_KEY]);
  });
  it("refuses firm B's document and starts nothing", async () => {
    const answer = await runTool(await world(FIRM_B, FIRM_A, true), FIRM_A_KEY);
    expect(String(answer.error)).toMatch(/no longer available/);
    expect(started.credentialRefs).toEqual([]);
  });
});

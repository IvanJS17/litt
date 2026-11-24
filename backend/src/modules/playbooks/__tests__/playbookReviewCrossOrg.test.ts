// A review whose document belongs to another organization than the playbook.
// A firm's key chosen for the work runs only work whose playbook AND document
// belong to that firm; a person's own key keeps working as before.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { saveApiKeyFor } from "../../../lib/providerCredentials/store";

const docs = vi.hoisted(() => ({
  loadActiveVersion: vi.fn(),
  loadCurrentVersionBytes: vi.fn(),
  extractDocxBodyText: vi.fn(),
}));
vi.mock("../../documents/documents.service", async (original) => ({
  ...(await original<typeof import("../../documents/documents.service")>()),
  loadCurrentVersionBytes: docs.loadCurrentVersionBytes,
}));
vi.mock("../../../lib/documentVersions", async (original) => ({
  ...(await original<typeof import("../../../lib/documentVersions")>()),
  loadActiveVersion: docs.loadActiveVersion,
}));
vi.mock("../../../lib/docxTrackedChanges", async (original) => ({
  ...(await original<typeof import("../../../lib/docxTrackedChanges")>()),
  extractDocxBodyText: docs.extractDocxBodyText,
}));

import { blankPlaybookContent, beginPlaybookReview } from "../playbooks.operations";
import { database, ORG as FIRM_A, OTHER as FIRM_B, type Row } from "./playbookTestDb";

/** An encrypted key row as the database stores it. */
async function keyRow(
  owner: { kind: "user" | "org"; id: string },
  secret: string,
): Promise<Row> {
  const saved: Row[] = [];
  const recorder = {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: async (payload: Row) => (saved.push(payload), { error: null }),
        upsert: (payload: Row) => (saved.push(payload), builder),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
  } as unknown as Db;
  await saveApiKeyFor(owner, "claude" as never, secret, recorder);
  return {
    ...saved[0]!,
    ...(owner.kind === "org" ? { org_id: owner.id } : { user_id: owner.id }),
    version: 1,
    credential_ref: "claude:v1",
  };
}

async function world(documentOrg: string | null, playbookOrg: string | null = FIRM_A) {
  const { db, tables } = database(
    [
      {
        id: "book",
        user_id: playbookOrg ? "owner" : "u1",
        org_id: playbookOrg,
        visibility: playbookOrg ? "organization" : "private",
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
  tables.org_api_keys = [
    await keyRow({ kind: "org", id: FIRM_A }, "sk-firm-a"),
    await keyRow({ kind: "org", id: FIRM_B }, "sk-firm-b"),
  ];
  tables.user_api_keys = [await keyRow({ kind: "user", id: "u1" }, "sk-own")];
  tables.documents = [
    { id: "doc", user_id: "u1", project_id: null, workflow_id: null, org_id: documentOrg },
  ];
  return db;
}

const review = (db: Db, credentialRef?: string) =>
  beginPlaybookReview({
    userId: "u1",
    playbookId: "book",
    documentId: "doc",
    model: "claude-opus-5",
    reviewMode: "strict",
    credentialRef,
    db,
  });

beforeEach(() => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) vi.stubEnv(name, "");
  docs.loadActiveVersion.mockResolvedValue({ id: "v1", filename: "msa.docx", file_type: "docx" });
  docs.loadCurrentVersionBytes.mockResolvedValue({ bytes: Buffer.from(""), storage_path: "p" });
  docs.extractDocxBodyText.mockResolvedValue("Contract text");
});
afterEach(() => vi.unstubAllEnvs());

describe("reviewing a document of another organization with a playbook of this one", () => {
  const firmAKey = `org:${FIRM_A}:claude:v1`;

  it("runs on the firm's key when playbook and document both belong to that firm", async () => {
    const started = await review(await world(FIRM_A), firmAKey);
    expect(started.resolved.route.credentialRef).toBe(firmAKey);
  });

  it.each([
    ["a document of another firm", FIRM_B],
    ["a personal document", null],
  ])("refuses the firm's key for %s", async (_name, documentOrg) => {
    await expect(review(await world(documentOrg), firmAKey)).rejects.toMatchObject({
      status: 409,
      code: "chat_route_credential_unavailable",
    });
  });

  it("refuses the key of the document's firm for a playbook of another firm or a personal one", async () => {
    const firmBKey = `org:${FIRM_B}:claude:v1`;
    await expect(review(await world(FIRM_B, FIRM_A), firmBKey)).rejects.toMatchObject({
      code: "chat_route_credential_unavailable",
    });
    await expect(review(await world(FIRM_B, null), firmBKey)).rejects.toMatchObject({
      code: "chat_route_credential_unavailable",
    });
  });

  it("keeps the person's own key working for it, as before (open question for the owner)", async () => {
    const started = await review(await world(FIRM_B), "user:u1:claude:v1");
    expect(started.resolved.route.credentialRef).toBe("user:u1:claude:v1");
  });
});

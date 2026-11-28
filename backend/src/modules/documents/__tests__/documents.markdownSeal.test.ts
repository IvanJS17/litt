import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({ access: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("../documents.access", () => ({ ensureDocumentAccess: mocks.access }));
vi.mock("../documents.textSearch", () => ({ readStoredDocumentText: vi.fn() }));
vi.mock("../documents.indexing", () => ({ processDocumentTextInline: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../lib/storage", () => ({
  uploadFile: mocks.upload,
  deleteFile: mocks.remove,
  versionStorageKey: (user: string, doc: string, slug: string, name: string) => `v/${user}/${doc}/${slug}/${name}`,
}));

import { saveMarkdownEdit } from "../documents.markdown";

const DOC = "11111111-1111-4111-8111-111111111111";
const BASE = "22222222-2222-4222-8222-222222222222";
const sealed = { id: BASE, training_author_user_id: "other-trainee", training_stage: "pasante", content_sha256: "h" };
const never = { id: BASE, training_author_user_id: null, training_stage: null, content_sha256: "h" };
const heldOrg = { table: "documents", data: { org_id: "org" } };
const org = { table: "documents", data: { org_id: "org", project_id: null } };
const pasante = { table: "training_stages", data: [{ practice: null, stage: "pasante" }] };
const lawyer = { table: "training_stages", data: [] };
const approval = { table: "training_version_approvals", data: [{ document_version_id: BASE, content_sha256: "h" }] };
const noApproval = { table: "training_version_approvals", data: [] };
const rpc = { rpc: "create_document_version", data: { id: "new", version_number: 2, source: "user_edit", created_at: "t", filename: "n.md" } };

// [who saves, the version it is saved on, reads after the base, held under]
const cases = [
  ["a pasante", "held under another pasante", [noApproval, heldOrg], "other-trainee"],
  ["a lawyer", "held under a pasante", [noApproval, heldOrg], "other-trainee"],
  ["a pasante", "sealed and approved", [approval, org, pasante], "maker"],
  ["a lawyer", "sealed and approved", [approval, org, lawyer], null],
  ["a pasante", "never sealed", [org, pasante], "maker"],
  ["a lawyer", "never sealed", [org, lawyer], null],
] as const;

function expectSeal(version: Record<string, unknown>, heldUnder: string | null) {
  if (heldUnder) expect(version).toMatchObject({ training_author_user_id: heldUnder, training_stage: "pasante" });
  else {
    expect(version).not.toHaveProperty("training_author_user_id");
    expect(version).not.toHaveProperty("training_stage");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.access.mockResolvedValue({ ok: true, doc: { id: DOC, current_version_id: BASE }, isCreator: true, projectRole: "editor" });
});

describe.each(cases)("%s saves Markdown on a version %s", (_who, what, reads, heldUnder) => {
  it("is held under the version's author when that version is held, else under its maker", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: { id: BASE, filename: "n.md", file_type: "md" } },
      { table: "document_versions", data: [what === "never sealed" ? never : sealed] },
      ...reads,
      rpc,
    ]);
    const result = await saveMarkdownEdit(fake.db, { documentId: DOC, userId: "maker", userEmail: undefined, text: "# Hola", baseVersionId: BASE });
    expect(result.ok).toBe(true);
    const sent = fake.calls.at(-1)!.args as { p_version: Record<string, unknown> };
    expect(sent.p_version.base_version_id).toBe(BASE);
    expectSeal(sent.p_version, heldUnder);
    fake.done();
  });
});

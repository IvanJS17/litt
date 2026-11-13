import { describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";
import { ensureDocAccess } from "../../../lib/access";
import { deleteDocument, ensureDocumentAccess, getDocument } from "../documents.access";
vi.mock("../../../lib/access", async (load) => ({ ...(await load<object>()), ensureDocAccess: vi.fn() }));
vi.mock("../../../lib/documentVersions", () => ({ attachActiveVersionPaths: vi.fn(), attachLatestVersionNumbers: vi.fn() }));
describe("document detail permissions", () => {
  it.each([
    ["viewer", false, "owner-id", null, false, false],
    ["editor", false, "owner-id", null, false, false],
    ["owner", true, "user", null, true, true],
    ["owner", false, null, null, true, true],
    ["editor", false, "owner-id", "workflow", true, true],
    // A creator downgraded to Viewer keeps provenance, not the right to
    // replace or destroy content in the project.
    ["viewer", true, "user", null, false, false],
  ] as const)("matches upload replacement and deletion rights (%s, creator %s)", async (projectRole, isCreator, creatorId, workflowId, canEdit, canDelete) => {
    vi.mocked(ensureDocAccess).mockResolvedValue({ ok: true, projectRole, isCreator, orgRole: null });
    const fake = scriptedDb([{ table: "documents", data: { id: "doc", user_id: creatorId, project_id: "project", workflow_id: workflowId } }]);
    expect(await getDocument("doc", "user", undefined, fake.db)).toMatchObject({ ok: true, doc: { can_edit: canEdit, can_delete: canDelete } });
    fake.done();
  });
});

describe("document deletion permissions", () => {
  it("refuses a creator whose project role was reduced to viewer", async () => {
    vi.mocked(ensureDocAccess).mockResolvedValue({ ok: true, projectRole: "viewer", isCreator: true, orgRole: null });
    const fake = scriptedDb([{ table: "documents", data: { id: "doc", user_id: "user", project_id: "project", workflow_id: null } }]);
    expect(await deleteDocument("doc", "user", fake.db)).toMatchObject({ ok: false, kind: "forbidden" });
    fake.done();
  });
});

describe("archived documents", () => {
  // A db that returns only the columns that were asked for, as PostgREST does.
  const archivedDb = () => {
    const row: Record<string, unknown> = { id: "doc", user_id: "user", project_id: null, current_version_id: "v1", archived_at: "2026-01-01T00:00:00Z" };
    return {
      from: () => ({
        select: (columns: string) => ({
          eq: () => ({
            single: async () => ({
              data: Object.fromEntries(columns.split(",").map((c) => c.trim()).filter((c) => c in row).map((c) => [c, row[c]])),
              error: null,
            }),
          }),
        }),
      }),
    } as never;
  };

  it("is not found, so it cannot be edited, even when the caller's column list omits archived_at", async () => {
    vi.mocked(ensureDocAccess).mockResolvedValue({ ok: true, projectRole: "owner", isCreator: true, orgRole: null });
    // The columns saveMarkdownEdit and the version routes ask for.
    const access = await ensureDocumentAccess("doc", "user", undefined, archivedDb(), {
      select: "id, current_version_id, user_id, project_id, org_id, workflow_id",
    });
    expect(access).toEqual({ ok: false, kind: "not_found" });
  });
});

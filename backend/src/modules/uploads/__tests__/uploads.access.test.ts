import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMocks = vi.hoisted(() => ({
  checkProjectAccess: vi.fn(),
  can: vi.fn(),
  checkWorkflowAccess: vi.fn(),
  creatorScopedAllowed: vi.fn(),
  ensureDocAccess: vi.fn(),
  resolveStandaloneOrgId: vi.fn(),
}));

vi.mock("../../../lib/access", () => accessMocks);

import { validateDestinationAccess } from "../uploads.access";

/** The filters each query was given, by table, for the cases that care. */
let filtersByTable: Record<string, [string, ...unknown[]][]> = {};

function dbWith(rows: Record<string, unknown>) {
  filtersByTable = {};
  return {
    from(table: string) {
      const filters = (filtersByTable[table] ??= []);
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => (filters.push(["eq", ...args]), query),
        is: (...args: unknown[]) => (filters.push(["is", ...args]), query),
        in: (...args: unknown[]) => (filters.push(["in", ...args]), query),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: Array.isArray(rows[table]) ? rows[table] : [],
            error: null,
          }).then(resolve),
      };
      return query;
    },
  };
}

const file = {
  id: "33333333-3333-4333-8333-333333333333",
  resource_id: "44444444-4444-4444-8444-444444444444",
  client_id: "client-1",
  filename: "contract.pdf",
  target_folder_id: null,
  file_type: "pdf",
  content_type: "application/pdf",
  expected_size_bytes: 4,
  staging_storage_path: "staging",
  sealed_storage_path: "sealed",
};

// The guard returns a failure instead of writing to `res`; the route turns
// `status` into the response. A rejected destination is always a 404 so the
// answer never reveals whether the resource exists.
function rejection(outcome: Awaited<ReturnType<typeof validateDestinationAccess>>) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("expected the destination to be rejected");
  if (outcome.kind !== "http") throw new Error("expected an http failure");
  return outcome;
}

describe("upload destination authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No organization named: Personal.
    accessMocks.resolveStandaloneOrgId.mockResolvedValue({
      ok: true,
      orgId: null,
    });
  });

  it("rejects a project the user cannot access", async () => {
    accessMocks.checkProjectAccess.mockResolvedValue({ ok: false });
    const outcome = await validateDestinationAccess(
      {
        purpose: "document_create",
        destination: {
          scope: "project",
          project_id: "55555555-5555-4555-8555-555555555555",
        },
        expected_total_bytes: 4,
        files: [file],
      },
      "11111111-1111-4111-8111-111111111111",
      "user@example.com",
      dbWith({}) as never,
    );
    expect(rejection(outcome).status).toBe(404);
  });

  it("rejects a document the user cannot edit", async () => {
    accessMocks.ensureDocAccess.mockResolvedValue({ ok: false });
    const outcome = await validateDestinationAccess(
      {
        purpose: "document_version_create",
        destination: {
          document_id: "55555555-5555-4555-8555-555555555555",
        },
        expected_total_bytes: 4,
        files: [file],
      },
      "11111111-1111-4111-8111-111111111111",
      "user@example.com",
      dbWith({
        documents: {
          id: "55555555-5555-4555-8555-555555555555",
          user_id: "another-user",
          project_id: null,
        },
      }) as never,
    );
    expect(rejection(outcome).status).toBe(404);
  });

  describe("an editor save (base_version_id)", () => {
    const documentId = "55555555-5555-4555-8555-555555555555";
    const baseVersionId = "77777777-7777-4777-8777-777777777777";
    const docx = { ...file, filename: "edited.docx", file_type: "docx" };
    const request = (over: { base?: string; file?: typeof file } = {}) => ({
      purpose: "document_version_create" as const,
      destination: { document_id: documentId, base_version_id: over.base ?? baseVersionId },
      expected_total_bytes: 4,
      files: [over.file ?? docx],
    });
    const check = (current: string | null, over: Parameters<typeof request>[0] = {}) => {
      accessMocks.ensureDocAccess.mockResolvedValue({ ok: true, projectRole: "owner" });
      accessMocks.can.mockReturnValue(true);
      return validateDestinationAccess(
        request(over),
        "11111111-1111-4111-8111-111111111111",
        "user@example.com",
        dbWith({ documents: { id: documentId, user_id: "x", project_id: null, current_version_id: current } }) as never,
      );
    };

    it("is accepted on top of the current version", async () => {
      expect((await check(baseVersionId)).ok).toBe(true);
    });

    it("is refused with 409 document_version_conflict when the document has a newer version", async () => {
      const outcome = rejection(await check("99999999-9999-4999-8999-999999999999"));
      expect(outcome.status).toBe(409);
      expect(outcome.body).toMatchObject({ code: "document_version_conflict" });
    });

    it("is refused for anything that is not a Word document", async () => {
      expect(rejection(await check(baseVersionId, { file })).status).toBe(400);
    });

    it("a plain new version needs no base", async () => {
      accessMocks.ensureDocAccess.mockResolvedValue({ ok: true, projectRole: "owner" });
      accessMocks.can.mockReturnValue(true);
      const outcome = await validateDestinationAccess(
        { ...request(), destination: { document_id: documentId } },
        "11111111-1111-4111-8111-111111111111",
        "user@example.com",
        dbWith({ documents: { id: documentId, user_id: "x", project_id: null } }) as never,
      );
      expect(outcome.ok).toBe(true);
    });
  });

  it("rejects a workflow that is neither owned nor editable", async () => {
    accessMocks.checkWorkflowAccess.mockResolvedValue({ ok: false });
    const outcome = await validateDestinationAccess(
      {
        purpose: "workflow_reference_create",
        destination: {
          workflow_id: "55555555-5555-4555-8555-555555555555",
        },
        expected_total_bytes: 4,
        files: [file],
      },
      "11111111-1111-4111-8111-111111111111",
      "user@example.com",
      dbWith({
        workflows: {
          id: "55555555-5555-4555-8555-555555555555",
          user_id: "another-user",
          type: "assistant",
        },
        workflow_shares: { allow_edit: false },
      }) as never,
    );
    expect(rejection(outcome).status).toBe(404);
  });

  // A document uploaded on its own belongs to the workspace the manifest
  // names, which must be one of the uploader's.
  describe("a document uploaded on its own", () => {
    const USER = "11111111-1111-4111-8111-111111111111";
    const ORG = "66666666-6666-4666-8666-666666666666";
    const FOLDER = "77777777-7777-4777-8777-777777777777";
    const upload = (destination: Record<string, unknown>, rows = {}) =>
      validateDestinationAccess(
        {
          purpose: "document_create",
          destination,
          expected_total_bytes: 4,
          files: [file],
        } as never,
        USER,
        "user@example.com",
        dbWith(rows) as never,
      );

    it.each([
      ["attached to a chat", { scope: "standalone", org_id: ORG }],
      ["added to the library", { scope: "library", library_kind: "file", org_id: ORG }],
    ])("checks the organization it names when %s", async (_label, destination) => {
      accessMocks.resolveStandaloneOrgId.mockResolvedValue({ ok: true, orgId: ORG });
      await expect(upload(destination)).resolves.toEqual({ ok: true });
      expect(accessMocks.resolveStandaloneOrgId).toHaveBeenCalledWith(
        expect.anything(),
        { userId: USER, orgId: ORG },
      );
    });

    it("refuses an organization the uploader does not belong to, before any upload", async () => {
      accessMocks.resolveStandaloneOrgId.mockResolvedValue({
        ok: false,
        detail: "You are not a member of that organization.",
      });
      const outcome = rejection(
        await upload({ scope: "standalone", org_id: ORG }),
      );
      expect(outcome.status).toBe(400);
      expect(outcome.body).toEqual({
        detail: "You are not a member of that organization.",
      });
    });

    it("only files into a folder of the same workspace", async () => {
      accessMocks.resolveStandaloneOrgId.mockResolvedValue({ ok: true, orgId: ORG });
      await upload(
        { scope: "library", library_kind: "file", folder_id: FOLDER, org_id: ORG },
        { library_folders: [{ id: FOLDER }] },
      );
      expect(filtersByTable.library_folders).toContainEqual(["eq", "org_id", ORG]);

      // In Personal: only a folder with no organization.
      accessMocks.resolveStandaloneOrgId.mockResolvedValue({ ok: true, orgId: null });
      await upload(
        { scope: "library", library_kind: "file", folder_id: FOLDER },
        { library_folders: [{ id: FOLDER }] },
      );
      expect(filtersByTable.library_folders).toContainEqual(["is", "org_id", null]);
    });

    it("reports a folder from another workspace as not found", async () => {
      accessMocks.resolveStandaloneOrgId.mockResolvedValue({ ok: true, orgId: ORG });
      // The narrowed lookup finds nothing.
      const outcome = rejection(
        await upload(
          { scope: "library", library_kind: "file", folder_id: FOLDER, org_id: ORG },
          { library_folders: [] },
        ),
      );
      expect(outcome.status).toBe(404);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// LiTT C4: an export bound to one organization is queued under the epoch of
// the authority that started it, and the build refuses to run under another.

const enqueueDbJob = vi.hoisted(() => vi.fn(async () => ({ id: "job-1" })));
vi.mock("../../../lib/dbq/enqueue", () => ({ enqueueDbJob }));

const buildAuditCsv = vi.hoisted(() => vi.fn(async () => "header\nrow"));
const canReadOrgAudit = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../../lib/auditExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/auditExport")>()),
  buildAuditCsv,
  canReadOrgAudit,
}));

const uploadFile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  uploadFile,
}));

const recordAudit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../lib/audit", () => ({ recordAudit }));

const buildUserChatsExport = vi.hoisted(() =>
  vi.fn(async () => ({ exported_at: "now" })),
);
vi.mock("../user.dataExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../user.dataExport")>()),
  buildUserChatsExport,
}));

import { startUserExport } from "../user.export";
import { handleExportBuild } from "../user.exportJobs";

/** organizations.authorization_epoch, plus the org-audit gate's own lookups. */
function makeDb(epoch: number) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const query: Record<string, unknown> = {};
      const self = () => query;
      query.select = self;
      query.eq = self;
      query.in = self;
      query.is = self;
      query.order = self;
      query.limit = self;
      query.maybeSingle = async () =>
        table === "organizations"
          ? { data: { authorization_epoch: epoch }, error: null }
          : { data: null, error: null };
      query.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return query;
    },
  } as never;
}

function auditJob(authorization: unknown) {
  return {
    id: "job-1",
    kind: "export.build",
    payload: {
      userId: "u1",
      userEmail: "u1@example.test",
      type: "audit-csv",
      query: { orgId: "org-1", page: 1, limit: 2000 },
      authorization,
    },
  } as never;
}

describe("export job authorization epoch (LiTT C4)", () => {
  beforeEach(() => {
    enqueueDbJob.mockClear();
    buildAuditCsv.mockClear();
    uploadFile.mockClear();
    recordAudit.mockClear();
  });

  it("stamps an organization export with the epoch it was queued under", async () => {
    const db = makeDb(7);
    const result = await startUserExport(db, {
      userId: "u1",
      type: "audit-csv",
      payload: { userId: "u1", type: "audit-csv", query: { orgId: "org-1" } },
    });
    expect(result).toEqual({ ok: true, exportId: "job-1" });
    expect(enqueueDbJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        payload: expect.objectContaining({
          authorization: { orgId: "org-1", epoch: 7 },
        }),
      }),
    );
  });

  it.each([
    ["queued before a revocation (epoch 6)", { orgId: "org-1", epoch: 6 }],
    ["queued without a stamp", undefined],
    ["stamped for another organization", { orgId: "org-2", epoch: 7 }],
  ])("an audit export %s fails before building or uploading", async (_label, authorization) => {
    const db = makeDb(7);
    await expect(
      handleExportBuild(db, auditJob(authorization)),
    ).rejects.toMatchObject({
      name: "StaleAuthorizationError",
      message: expect.stringMatching(/^stale_authorization_epoch/),
    });
    expect(buildAuditCsv).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("builds the export under the current epoch", async () => {
    const db = makeDb(7);
    await handleExportBuild(db, auditJob({ orgId: "org-1", epoch: 7 }));
    expect(buildAuditCsv).toHaveBeenCalledOnce();
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it("leaves a personal export unstamped", async () => {
    const db = makeDb(7);
    await expect(
      handleExportBuild(db, {
        id: "job-2",
        kind: "export.build",
        payload: { userId: "u1", userEmail: null, type: "chats" },
      } as never),
    ).resolves.toBeDefined();
    expect(buildUserChatsExport).toHaveBeenCalledOnce();
  });
});

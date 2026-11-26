import { beforeEach, describe, expect, it, vi } from "vitest";

// A queued export acts for the account as it is when the job runs: its
// current confirmed address, and no artifact once the account's erasure was
// requested.

const uploadFile = vi.hoisted(() => vi.fn(async () => {}));
const deleteFile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  uploadFile,
  deleteFile,
}));
vi.mock("../../../lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

const buildUserChatsExport = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ exported_at: "now" })));
vi.mock("../buildJsonExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../buildJsonExport")>()),
  buildUserChatsExport,
}));

import { handleExportBuild } from "../../jobs/exportBuild";

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  email: "now@example.test" as string | null,
}));

function makeDb() {
  return {
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: state.email, email_confirmed_at: "2026-01-01" } },
          error: null,
        }),
      },
    },
    from(table: string) {
      const query: Record<string, unknown> = {};
      const self = () => query;
      query.select = self;
      query.eq = self;
      query.maybeSingle = async () => ({ data: table === "user_profiles" ? state.profile : null, error: null });
      return query;
    },
  } as never;
}

const job = {
  id: "job-1",
  kind: "export.build",
  payload: { userId: "u1", userEmail: "copied-when-asked@example.test", type: "chats" },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  state.profile = null;
  state.email = "now@example.test";
});

describe("a queued export", () => {
  it("is built for the account's current address, not the one copied into the job", async () => {
    await handleExportBuild(makeDb(), job);
    expect(buildUserChatsExport).toHaveBeenCalledWith(expect.anything(), "u1", "now@example.test", null);
  });

  it("builds and stores nothing once the account's erasure was requested", async () => {
    state.profile = { account_deletion_requested_at: "2026-11-25T10:00:00Z" };
    await expect(handleExportBuild(makeDb(), job)).rejects.toThrow();
    expect(buildUserChatsExport).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("removes the copy it stored when the erasure was requested while it was building", async () => {
    buildUserChatsExport.mockImplementationOnce(async () => {
      state.profile = { account_deletion_requested_at: "2026-11-25T10:00:00Z" };
      return { exported_at: "now" };
    });
    await expect(handleExportBuild(makeDb(), job)).rejects.toThrow();
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^exports\/u1\/job-1-/));
  });
});

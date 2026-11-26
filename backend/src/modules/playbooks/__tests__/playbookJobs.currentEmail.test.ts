import { beforeEach, describe, expect, it, vi } from "vitest";

// A queued playbook job acts for the account as it is when the job runs: the
// address it matches shares and grants against is the account's current
// confirmed one, not the one copied into the job when it was asked for.

const seen = vi.hoisted(() => ({
  review: [] as unknown[],
  importDocument: [] as unknown[],
  draft: [] as unknown[],
}));

vi.mock("../playbooks.operations", async (original) => ({
  ...(await original<typeof import("../playbooks.operations")>()),
  runPlaybookReview: async (_db: unknown, work: unknown) => void seen.review.push(work),
  playbookImportDocument: async (_db: unknown, _userId: string, userEmail: unknown) => {
    seen.importDocument.push(userEmail);
    return { storagePath: "documents/u1/d1/file.docx", filename: "file.docx", size: 1 };
  },
  compilePlaybookImport: async (_db: unknown, _payload: unknown, read: () => Promise<unknown>) => void (await read()),
}));
vi.mock("../playbooks.draft", async (original) => ({
  ...(await original<typeof import("../playbooks.draft")>()),
  compilePlaybookDraft: async (_db: unknown, payload: unknown) => void seen.draft.push(payload),
}));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  downloadFile: async () => new ArrayBuffer(4),
  deleteFile: async () => {},
}));

import type { DbJob } from "../../../lib/dbq/types";
import { handlePlaybookDraft, handlePlaybookImport, handlePlaybookReview } from "../playbooks.jobs";

/** A database holding one running row, and an account whose address is `email`. */
function db(email: string) {
  return {
    from: () => {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({
        data: { id: "row-1", user_id: "u1", status: "running", kind: "draft", started_at: "2026-11-25T00:00:00Z" },
        error: null,
      });
      return query;
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email, email_confirmed_at: "2026-01-01T00:00:00Z" } },
          error: null,
        }),
      },
    },
  } as never;
}

const job = (payload: Record<string, unknown>): DbJob =>
  ({ id: "job-1", kind: "playbook", payload, status: "running", attempts: 1, max_attempts: 3 }) as unknown as DbJob;

beforeEach(() => {
  seen.review.length = 0;
  seen.importDocument.length = 0;
  seen.draft.length = 0;
});

describe("queued playbook jobs", () => {
  it("run a review for the account's current address", async () => {
    await handlePlaybookReview(db("now@example.test"), job({ runId: "row-1", userId: "u1", userEmail: "copied@example.test" }));
    expect(seen.review).toEqual([expect.objectContaining({ userEmail: "now@example.test" })]);
  });

  it("read an import's saved document for the account's current address", async () => {
    await handlePlaybookImport(
      db("now@example.test"),
      job({ attemptId: "row-1", userId: "u1", userEmail: "copied@example.test", documentId: "d1" }),
    );
    expect(seen.importDocument).toEqual(["now@example.test"]);
  });

  it("compile a draft for the account's current address", async () => {
    await handlePlaybookDraft(
      db("now@example.test"),
      job({ attemptId: "row-1", userId: "u1", userEmail: "copied@example.test" }),
    );
    expect(seen.draft).toEqual([expect.objectContaining({ userEmail: "now@example.test" })]);
  });
});

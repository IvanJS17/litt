import { afterEach, describe, expect, it, vi } from "vitest";

const { eraseAccount } = vi.hoisted(() => ({ eraseAccount: vi.fn(async () => {}) }));
vi.mock("../../jobs/accountDelete", () => ({ eraseAccount }));
vi.mock("../dataCleanup", () => ({ listOrgsBlockingAccountDeletion: async () => [] }));
vi.mock("../../../lib/dbq/runner", () => ({ dbJobsEnabled: () => false }));

import { deleteUserAccount } from "../deleteAccount";
import { resetStreamRunsForTests, startStreamRun } from "../../../lib/streamRuns";

const db = {
    rpc: async () => ({ data: "job-1", error: null }),
    auth: { admin: { signOut: async () => ({}) } },
    from: () => ({
        update: () => ({ eq: async () => ({ error: null }) }),
    }),
};

afterEach(() => resetStreamRunsForTests());

describe("erasing an account", () => {
    it("stops the person's running turns before the data is erased, and only theirs", async () => {
        const mine = startStreamRun({ id: "r1", key: "chat:1", userId: "u1", forcedStopFrames: [] })!;
        const other = startStreamRun({ id: "r2", key: "chat:2", userId: "u2", forcedStopFrames: [] })!;
        let abortedWhenErasing: boolean | null = null;
        eraseAccount.mockImplementationOnce(async () => {
            abortedWhenErasing = mine.signal.aborted;
        });

        const result = await deleteUserAccount(db as never, "u1", "token");

        expect(result.ok).toBe(true);
        expect(abortedWhenErasing).toBe(true);
        expect(mine.signal.aborted).toBe(true);
        expect(other.signal.aborted).toBe(false);
    });
});

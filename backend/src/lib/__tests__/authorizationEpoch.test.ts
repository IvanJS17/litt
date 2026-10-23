import { describe, expect, it } from "vitest";
import {
    assertAuthorizationStamp,
    readAuthorizationStamp,
    StaleAuthorizationError,
} from "../authorizationEpoch";
import { NonRetryableJobError } from "../dbq/runner";

// LiTT C4: queued work carries the organization's authorization epoch and is
// refused once it has moved.
function db(epoch: unknown, error: unknown = null) {
    const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
            data: epoch === undefined ? null : { authorization_epoch: epoch },
            error,
        }),
    };
    return { from: () => query } as never;
}

describe("authorization epochs for queued work", () => {
    it("stamps organization work with the current epoch and personal work with nothing", async () => {
        expect(await readAuthorizationStamp(db(5), "org")).toEqual({ orgId: "org", epoch: 5 });
        expect(await readAuthorizationStamp(db(5), null)).toBeNull();
    });

    it("refuses to stamp when the epoch cannot be read", async () => {
        await expect(readAuthorizationStamp(db(5, { message: "down" }), "org")).rejects.toThrow();
        await expect(readAuthorizationStamp(db(undefined), "org")).rejects.toThrow();
    });

    it("lets current work run and refuses stale, missing or foreign stamps terminally", async () => {
        await expect(assertAuthorizationStamp(db(5), "org", { orgId: "org", epoch: 5 })).resolves.toBeUndefined();
        await expect(assertAuthorizationStamp(db(5), null, undefined)).resolves.toBeUndefined();
        for (const stamp of [{ orgId: "org", epoch: 4 }, undefined, { orgId: "other", epoch: 5 }, { orgId: "org", epoch: "5" }]) {
            const error = await assertAuthorizationStamp(db(5), "org", stamp).catch((e) => e);
            expect(error).toBeInstanceOf(StaleAuthorizationError);
            // The DB runner fails it at once instead of spending its retries.
            expect(error).toBeInstanceOf(NonRetryableJobError);
        }
        // An organization that is gone is stale too.
        await expect(assertAuthorizationStamp(db(undefined), "org", { orgId: "org", epoch: 5 })).rejects.toBeInstanceOf(
            StaleAuthorizationError,
        );
    });
});

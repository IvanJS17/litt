import { describe, expect, it } from "vitest";
import { mayAddDocumentHere } from "../documentOps";

/** A database that only knows the person's profile row. */
function dbWithProfile(profile: Record<string, unknown> | null) {
    return {
        from: (table: string) => {
            if (table !== "user_profiles") throw new Error(`unexpected read of ${table}`);
            const query = {
                select: () => query,
                eq: () => query,
                maybeSingle: async () => ({ data: profile, error: null }),
            };
            return query;
        },
    } as never;
}

const personal = { userId: "u1", userEmail: "u1@test.local", projectId: null, orgId: null };

describe("a running turn adding a document", () => {
    it("may, in the personal workspace of an account that is not being erased", async () => {
        expect(await mayAddDocumentHere(dbWithProfile({ account_deletion_requested_at: null }), personal)).toBe(true);
    });

    it("may not once the account's erasure was requested", async () => {
        expect(
            await mayAddDocumentHere(
                dbWithProfile({ account_deletion_requested_at: "2026-11-25T10:00:00Z" }),
                personal,
            ),
        ).toBe(false);
    });
});

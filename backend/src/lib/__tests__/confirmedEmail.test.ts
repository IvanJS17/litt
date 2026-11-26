import { describe, expect, it } from "vitest";
import { currentConfirmedEmail } from "../confirmedEmail";

const dbWith = (result: { data?: unknown; error?: unknown }) =>
    ({ auth: { admin: { getUserById: async () => result } } }) as never;

describe("currentConfirmedEmail", () => {
    it("is the confirmed address, lower-cased", async () => {
        const db = dbWith({ data: { user: { email: "Pat@Example.TEST", email_confirmed_at: "2026-01-01" } } });
        expect(await currentConfirmedEmail(db, "u1")).toBe("pat@example.test");
    });

    it("is empty when the address is not confirmed or the account has none", async () => {
        expect(await currentConfirmedEmail(dbWith({ data: { user: { email: "pat@example.test" } } }), "u1")).toBe("");
        expect(await currentConfirmedEmail(dbWith({ data: { user: null } }), "u1")).toBe("");
    });

    it("fails when the account cannot be read", async () => {
        await expect(currentConfirmedEmail(dbWith({ error: { message: "down" } }), "u1")).rejects.toThrow();
    });
});

import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// Layer 3, card 8: the conclusions of the holder's answers as a junior are
// theirs to take with them, and only theirs.
const userId = "holder";
const other = "colleague";

const check = (over: Row): Row => ({
    id: "b1", org_id: "org-a", trainee_user_id: userId, chat_id: "c1", word_chat_id: null, tabular_chat_id: null,
    message_id: "m1", status: "ready", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    conclusions: [{ id: "c1", text: "El plazo es de tres años", status: "backed", person_verified: true, person_note: null }],
    ...over,
});

function tables(): Record<string, Row[]> {
    return {
        organizations: [{ id: "org-a", kind: "team" }, { id: "org-b", kind: "team" }],
        org_members: [
            { org_id: "org-a", user_id: userId, role: "member" },
            { org_id: "org-b", user_id: userId, role: "member" },
        ],
        training_backing_checks: [
            check({}),
            check({ id: "b2", org_id: "org-b", chat_id: null, word_chat_id: "w1", message_id: "m2", created_at: "2026-01-02T00:00:00Z" }),
            // Somebody else's: not the holder's data.
            check({ id: "b3", trainee_user_id: other, message_id: "m3", created_at: "2026-01-03T00:00:00Z" }),
        ],
    };
}

describe("account export: the holder's accountability checks", () => {
    it("carries the holder's own, with their marks and notes", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", null)) as any;
        expect(out.training.backing_checks.map((r: Row) => r.id)).toEqual(["b1", "b2"]);
        expect(out.training.backing_checks[0]).toMatchObject({
            org_id: "org-a", chat_id: "c1", message_id: "m1", status: "ready",
            conclusions: [{ id: "c1", person_verified: true }],
        });
        expect(out.training.backing_checks[0]).not.toHaveProperty("trainee_user_id");
    });

    it("an organization's export carries only that organization's", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", "org-b")) as any;
        expect(out.training.backing_checks.map((r: Row) => r.id)).toEqual(["b2"]);
    });
});

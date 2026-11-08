import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// Layer 3, card 13: the criteria contrasts of the holder are theirs to take
// with them, and only theirs; no mentor id travels with them.
const userId = "holder";
const other = "colleague";

const contrast = (over: Row): Row => ({
    id: "k1", org_id: "org-a", trainee_user_id: userId, chat_id: "c1", message_id: "m1", status: "explained",
    routes: [{ name: "fast", provider: "gemini", model: "m", status: "completed" }],
    briefs: ["Uno", "Dos"], person_explanation: "Mi explicación", comparison: "Coincide", mentor_user_id: "leak",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
});

function tables(): Record<string, Row[]> {
    return {
        organizations: [{ id: "org-a", kind: "team" }, { id: "org-b", kind: "team" }],
        org_members: [
            { org_id: "org-a", user_id: userId, role: "member" },
            { org_id: "org-b", user_id: userId, role: "member" },
        ],
        training_criteria_contrasts: [
            contrast({}),
            contrast({ id: "k2", org_id: "org-b", chat_id: "c2", message_id: "m2", created_at: "2026-01-02T00:00:00Z" }),
            contrast({ id: "k3", trainee_user_id: other, message_id: "m3", created_at: "2026-01-03T00:00:00Z" }),
        ],
    };
}

describe("account export: the holder's criteria contrasts", () => {
    it("carries the holder's own, with the analyses, their explanation and the comparison", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", null)) as any;
        expect(out.training.criteria_contrasts.map((r: Row) => r.id)).toEqual(["k1", "k2"]);
        expect(out.training.criteria_contrasts[0]).toMatchObject({
            org_id: "org-a", chat_id: "c1", status: "explained", briefs: ["Uno", "Dos"],
            person_explanation: "Mi explicación", comparison: "Coincide",
        });
        expect(out.training.criteria_contrasts[0]).not.toHaveProperty("trainee_user_id");
        expect(JSON.stringify(out.training.criteria_contrasts)).not.toContain("leak");
    });

    it("an organization's export carries only that organization's", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", "org-b")) as any;
        expect(out.training.criteria_contrasts.map((r: Row) => r.id)).toEqual(["k2"]);
    });
});

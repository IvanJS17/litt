import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../user.dataExport";
import { makeExportDb, type Row } from "./user.dataExport.fixture";

const userId = "holder";
const other = "colleague";

function tables(): Record<string, Row[]> {
    return {
        organizations: [
            { id: "org-a", kind: "team" },
            { id: "org-b", kind: "team" },
        ],
        org_members: [
            { org_id: "org-a", user_id: userId, role: "member" },
            { org_id: "org-b", user_id: userId, role: "member" },
        ],
        training_mentors: [
            { org_id: "org-a", user_id: userId, designated_by: "boss" },
            { org_id: "org-a", user_id: other, designated_by: "boss" },
        ],
        training_pupils: [
            { org_id: "org-a", trainee_user_id: userId, mentor_user_id: other },
            { org_id: "org-b", trainee_user_id: userId, mentor_user_id: other },
            // Somebody else's pupil: not the holder's data.
            { org_id: "org-a", trainee_user_id: other, mentor_user_id: userId },
        ],
        training_stages: [
            { org_id: "org-a", trainee_user_id: userId, practice: "laboral", stage: "pasante" },
            { org_id: "org-b", trainee_user_id: userId, practice: null, stage: "junior" },
            { org_id: "org-a", trainee_user_id: other, practice: null, stage: "pasante" },
        ],
    };
}

describe("account export: the holder's training", () => {
    it("Personal's export carries it for every organization, only the holder's own", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", null)) as any;
        expect(out.training.mentor_designations.map((r: Row) => r.org_id)).toEqual(["org-a"]);
        expect(out.training.as_pupil.map((r: Row) => [r.org_id, r.mentor_user_id])).toEqual([
            ["org-a", other],
            ["org-b", other],
        ]);
        expect(out.training.stages.map((r: Row) => [r.org_id, r.practice, r.stage])).toEqual([
            ["org-a", "laboral", "pasante"],
            ["org-b", null, "junior"],
        ]);
    });

    it("an organization's export carries only that organization's", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", "org-b")) as any;
        expect(out.training.mentor_designations).toEqual([]);
        expect(out.training.as_pupil.map((r: Row) => r.org_id)).toEqual(["org-b"]);
        expect(out.training.stages.map((r: Row) => r.org_id)).toEqual(["org-b"]);
    });
});

import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { loadFirmProfileFor } from "../firmProfileStore";

const profile = { hq_state: "JAL", size: "2-5" };

function db() {
    const tables: Record<string, Row[]> = {
        organizations: [
            { id: "firm", name: "Aurora", kind: "team", firm_profile: profile },
            { id: "other", name: "Otro", kind: "team", firm_profile: { size: "51+" } },
            { id: "personal", name: "Personal", kind: "personal", firm_profile: profile },
        ],
    };
    return memoryDb(tables).db as never;
}

describe("loadFirmProfileFor", () => {
    it("answers for the firm the chat belongs to, and only that one", async () => {
        expect(await loadFirmProfileFor(db(), "firm")).toEqual(profile);
        expect(await loadFirmProfileFor(db(), "other")).toEqual({ size: "51+" });
    });

    it("answers nothing for a personal space, even if a row carried a profile", async () => {
        expect(await loadFirmProfileFor(db(), "personal")).toBeNull();
        expect(await loadFirmProfileFor(db(), null)).toBeNull();
        expect(await loadFirmProfileFor(db(), undefined)).toBeNull();
    });

    it("never fails the chat when the profile cannot be read", async () => {
        const broken = { from: () => { throw new Error("down"); } } as never;
        expect(await loadFirmProfileFor(broken, "firm")).toBeNull();
    });
});

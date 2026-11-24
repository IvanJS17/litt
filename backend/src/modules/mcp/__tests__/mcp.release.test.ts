import { describe, expect, it } from "vitest";
import { NO_ACCESS_CODE, OUTSIDE_CONNECTION_CODE, SOURCE_UNKNOWN_CODE, withheldFields } from "../mcp.release";

// A connected application is told which of the reasons holds, and the text
// says only what is true for it.
describe("withheldFields", () => {
    it("says lost access for lost access", () => {
        expect(withheldFields({ ok: false, reason: "no_access" })).toMatchObject({ code: NO_ACCESS_CODE, withheld_no_access: true });
        expect(withheldFields({ ok: false, reason: "no_access" }).next_step).toContain("do not have access");
    });

    it("says the sources cannot be identified, without claiming a loss of access, for an unknown or vanished source", () => {
        const fields = withheldFields({ ok: false, reason: "source_unknown" });
        expect(fields).toMatchObject({ code: SOURCE_UNKNOWN_CODE, withheld_source_unknown: true });
        expect(fields.next_step).toContain("can no longer be identified or no longer exist");
        expect(fields.next_step).not.toContain("do not have access");
    });

    it("keeps the connection's own reason apart", () => {
        expect(withheldFields({ ok: false, reason: "outside_connection" })).toMatchObject({ code: OUTSIDE_CONNECTION_CODE });
    });
});

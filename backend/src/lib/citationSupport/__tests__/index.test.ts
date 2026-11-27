import { describe, expect, it } from "vitest";

import * as index from "../index";

describe("the citation check's index", () => {
    it("does not export the functions that send without the person's daily number", () => {
        expect(Object.keys(index)).not.toContain("runCitationSupportChecks");
        expect(Object.keys(index)).not.toContain("askCitationSupport");
        expect(typeof index.createCitationSupportRunner).toBe("function");
    });
});
